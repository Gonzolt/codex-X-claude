const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { StringDecoder } = require('node:string_decoder');
const { JsonLines, describeItem } = require('./protocol.cjs');
const exec = promisify(execFile);

async function findExecutable(name) {
  try {
    const { stdout } = await exec(process.platform === 'win32' ? 'where.exe' : 'which', [name], { windowsHide: true, timeout: 5000 });
    const found = stdout.trim().split(/\r?\n/).find(p => !/\.(cmd|bat|ps1)$/i.test(p));
    if (found) return found;
  } catch { /* Try native installer locations next. */ }
  const home = homedir();
  const candidates = [join(home, '.local', 'bin', name + (process.platform === 'win32' ? '.exe' : ''))];
  if (name === 'codex' && process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (existsSync(root)) for (const version of readdirSync(root).reverse()) candidates.push(join(root, version, 'codex.exe'));
  }
  return candidates.find(p => existsSync(p)) || null;
}

async function detectAgents() {
  const result = {};
  await Promise.all(['codex', 'claude'].map(async name => {
    const path = await findExecutable(name);
    if (!path) { result[name] = { installed: false, signedIn: false, version: '', path: null }; return; }
    let version = '', signedIn = false;
    try { version = (await exec(path, ['--version'], { windowsHide: true, timeout: 10000 })).stdout.trim(); } catch {}
    try {
      const info = await exec(path, name === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json'], { windowsHide: true, timeout: 10000 });
      signedIn = name === 'codex' ? /logged in/i.test(info.stdout + info.stderr) : JSON.parse(info.stdout).loggedIn === true;
    } catch {}
    result[name] = { installed: true, signedIn, version, path };
  }));
  return result;
}

class CodexAgent {
  constructor(path, emit, approval) {
    this.path = path; this.emit = emit; this.approval = approval;
    this.pending = new Map(); this.sequence = 0; this.thread = null; this.turn = null;
    this.child = null; this.waiter = null; this.stopping = false;
  }
  async connect() {
    if (this.child) return;
    const env = { ...process.env };
    delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
    const child = spawn(this.path, ['app-server', '--listen', 'stdio://'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const parser = new JsonLines();
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', data => parser.push(decoder.write(data)));
    // Read stderr to prevent backpressure; protocol errors are reported over JSON-RPC.
    child.stderr.on('data', () => {});
    parser.on('message', message => { if (this.child === child) this.onMessage(message); });
    parser.on('invalid', error => { if (this.child === child) this.closeWithError(error); });
    child.on('error', error => { if (this.child === child) this.closeWithError(error); });
    child.on('exit', () => { if (this.child === child) this.fail(new Error('Codex disconnected. Try the task again.')); });
    child.stdin.on('error', error => { if (this.child === child) this.closeWithError(error); });
    try {
      await this.request('initialize', { clientInfo: { name: 'codex_x_claude', title: 'Codex x Claude', version: '0.1.0' } });
      this.send({ method: 'initialized', params: {} });
    } catch (error) { this.close(); throw error; }
  }
  send(message) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Codex is disconnected.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  fail(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    if (this.waiter) { this.waiter.reject(error); this.waiter = null; }
    this.child = null; this.thread = null; this.turn = null;
  }
  async onMessage(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      return;
    }
    const params = message.params || {};
    if (message.id !== undefined && message.method) {
      try {
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
          const allow = !this.readOnly && await this.approval('codex', params.command || params.reason || 'Apply file changes', JSON.stringify(params, null, 2));
          if (this.child) this.send({ id: message.id, result: { decision: allow ? 'accept' : 'decline' } });
        } else {
          // Unsupported elicitation is explicit, never an unattended permission grant.
          this.emit('system', `Codex requested ${message.method}. This request is not supported yet.`, 'notice');
          if (this.child) this.send({ id: message.id, error: { code: -32601, message: 'This client does not support this request.' } });
        }
      } catch { /* A stopped process no longer needs a response. */ }
      return;
    }
    if (params.threadId && params.threadId !== this.thread) return;
    if (message.method === 'turn/started') {
      this.turn = params.turn.id;
      if (this.stopping) this.request('turn/interrupt', { threadId: this.thread, turnId: this.turn }).catch(() => {});
    }
    if (message.method === 'item/agentMessage/delta') this.emit('codex', params.delta, 'delta', params.itemId);
    if (message.method === 'item/started') {
      const detail = describeItem(params.item);
      if (detail) this.emit('codex', detail, 'tool', params.item.id);
    }
    if (message.method === 'item/completed' && params.item.type === 'agentMessage') {
      this.answer = params.item.text || this.answer;
      this.emit('codex', params.item.text || '', 'message', params.item.id);
    }
    if (message.method === 'item/commandExecution/outputDelta') this.emit('codex', params.delta, 'output', params.itemId);
    if (message.method === 'turn/diff/updated') this.emit('codex', 'File changes updated', 'change');
    if (message.method === 'error') this.emit('codex', params.error?.message || 'Codex reported an error', 'error');
    if (message.method === 'turn/completed' && this.waiter) {
      const waiter = this.waiter; this.waiter = null; this.turn = null;
      if (params.turn.status === 'completed') waiter.resolve(this.answer || 'Task completed.');
      else waiter.reject(new Error(params.turn.status === 'interrupted' ? 'Stopped.' : params.turn.error?.message || 'Codex could not finish the task.'));
    }
  }
  async run(prompt, cwd, readOnly) {
    this.stopping = false;
    await this.connect();
    if (this.stopping) throw new Error('Stopped.');
    if (!this.thread || this.cwd !== cwd || this.readOnly !== readOnly) {
      const result = await this.request('thread/start', { cwd, sandbox: readOnly ? 'readOnly' : 'workspaceWrite', approvalPolicy: 'on-request' });
      this.thread = result.thread.id; this.cwd = cwd; this.readOnly = readOnly;
    }
    if (this.stopping) throw new Error('Stopped.');
    this.answer = '';
    const done = new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
    // Attach a handler immediately, including when turn/start itself fails.
    done.catch(() => {});
    try {
      const result = await this.request('turn/start', { threadId: this.thread, input: [{ type: 'text', text: prompt }] });
      if (this.waiter) this.turn = result.turn.id;
      if (this.stopping && this.turn) await this.stop();
      return await done;
    } catch (error) {
      this.waiter = null;
      this.closeWithError(error);
      throw error;
    }
  }
  async stop() {
    this.stopping = true;
    if (this.thread && this.turn) await this.request('turn/interrupt', { threadId: this.thread, turnId: this.turn });
  }
  closeWithError(error) {
    const child = this.child;
    this.fail(error);
    if (child) { child.stdin.destroy(); child.kill(); }
  }
  close() { this.closeWithError(new Error('Stopped.')); }
}

class ClaudeAgent {
  constructor(path, emit, approval) { this.path = path; this.emit = emit; this.approval = approval; this.session = null; this.query = null; }
  async run(prompt, cwd, readOnly) {
    this.controller = new AbortController();
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    if (this.controller.signal.aborted) throw new Error('Stopped.');
    if (this.cwd !== cwd || this.readOnly !== readOnly) this.session = null;
    this.cwd = cwd; this.readOnly = readOnly;
    let answer = '', streamed = '', activeMessage = '';
    const env = { ...process.env };
    // This app deliberately uses the CLI's subscription login, not API billing.
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
    this.query = query({ prompt, options: {
      cwd, pathToClaudeCodeExecutable: this.path, env,
      abortController: this.controller, includePartialMessages: true,
      ...(this.session ? { resume: this.session } : {}),
      permissionMode: 'default', settingSources: [],
      allowedTools: ['Read', 'Glob', 'Grep'],
      ...(readOnly ? { disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Agent', 'Task'] } : {}),
      canUseTool: async (tool, input, options) => {
        if (tool === 'AskUserQuestion') return { behavior: 'deny', message: 'Ask the user in your response instead.' };
        if (readOnly) return { behavior: 'deny', message: 'This task is read-only. Use Read, Glob, and Grep.' };
        if (options.signal.aborted) return { behavior: 'deny', message: 'Stopped.' };
        const allow = await this.approval('claude', tool, JSON.stringify(input, null, 2));
        return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this action.' };
      }
    } });
    try {
      for await (const message of this.query) {
        if (message.session_id) this.session = message.session_id;
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'message_start') { activeMessage = event.message.id; streamed = ''; }
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            streamed += event.delta.text;
            this.emit('claude', event.delta.text, 'delta', activeMessage);
          }
        }
        if (message.type === 'assistant') {
          const text = message.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
          if (text) { answer = text; this.emit('claude', text, 'message', message.message.id || activeMessage); }
          for (const block of message.message.content) if (block.type === 'tool_use') {
            this.emit('claude', `${block.name}: ${JSON.stringify(block.input)}`, 'tool', block.id);
          }
        }
        if (message.type === 'result') {
          if (message.is_error || message.subtype !== 'success') throw new Error((message.errors || []).join('\n') || 'Claude could not finish the task. Check its sign-in and usage limits.');
          answer = message.result || answer || streamed;
        }
      }
      return answer || 'Task completed.';
    } finally { this.query = null; }
  }
  async stop() { this.controller?.abort(); }
  close() { this.controller?.abort(); this.query?.close?.(); }
}

module.exports = { CodexAgent, ClaudeAgent, detectAgents, findExecutable };
