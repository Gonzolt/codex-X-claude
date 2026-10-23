const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { StringDecoder } = require('node:string_decoder');
const { JsonLines, describeItem } = require('./protocol.cjs');
const { questionSchema } = require('./inputs.cjs');
const { LINES, activityKind } = require('./activity.cjs');
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
  restoreSession(session) { this.savedSession = session; }
  exportSession() { return this.thread ? { threadId: this.thread, cwd: this.cwd, readOnly: this.readOnly } : this.savedSession || null; }
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
      const requestChild = this.child;
      try {
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
          const allow = !this.readOnly && await this.approval('codex', params.command || params.reason || 'Apply file changes', JSON.stringify(params, null, 2));
          if (this.child === requestChild && this.child) this.send({ id: message.id, result: { decision: allow ? 'accept' : 'decline' } });
        } else if (message.method === 'mcpServer/elicitation/request') {
          const result = await this.approval('codex', params.message || `A request from ${params.serverName}`, params.message || '', {
            kind: params.mode === 'url' ? 'url' : 'form', schema: params.requestedSchema || { type: 'object', properties: {} },
            ...(params.mode === 'url' ? { url: params.url } : {})
          });
          if (this.child === requestChild && this.child) this.send({ id: message.id, result });
        } else if (['item/tool/requestUserInput', 'tool/requestUserInput'].includes(message.method)) {
          const questions = params.questions || [];
          const result = await this.approval('codex', 'A quick question', questions.map(q => q.question).join('\n'), { kind: 'form', schema: questionSchema(questions), autoEligible: false });
          const answers = Object.fromEntries(questions.map((question, index) => [question.id, { answers: result.action === 'accept' ? [String(result.content[question.id || String(index)])] : [] }]));
          if (this.child === requestChild && this.child) this.send({ id: message.id, result: { answers } });
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
      const kind = activityKind(params.item.type, params.item);
      this.emit('codex', LINES[kind], kind);
      const detail = describeItem(params.item);
      if (detail) this.emit('codex', detail, 'tool', params.item.id);
    }
    if (message.method === 'item/completed' && params.item.type === 'agentMessage') {
      this.answer = params.item.text || this.answer;
      this.emit('codex', params.item.text || '', 'message', params.item.id);
    }
    if (message.method === 'item/commandExecution/outputDelta') this.emit('codex', params.delta, 'output', params.itemId);
    if (message.method === 'turn/diff/updated') this.emit('codex', 'File changes updated', 'change');
    if (message.method === 'error') this.emit('codex', params.error?.message || 'Codex reported an error', params.willRetry ? 'notice' : 'error');
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
      const resume = this.savedSession?.cwd === cwd ? this.savedSession : null;
      const result = await this.request(resume ? 'thread/resume' : 'thread/start', { ...(resume ? { threadId: resume.threadId } : {}), cwd, sandbox: readOnly ? 'read-only' : 'workspace-write', approvalPolicy: 'on-request' });
      this.thread = result.thread.id; this.cwd = cwd; this.readOnly = readOnly;
      this.savedSession = this.exportSession();
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
  constructor(path, emit, approval, dependencies = {}) { this.path = path; this.emit = emit; this.approval = approval; this.session = null; this.query = null; this.dependencies = dependencies; }
  restoreSession(session) { if (session) { this.session = session.sessionId; this.cwd = session.cwd; this.readOnly = session.readOnly; } }
  exportSession() { return this.session ? { sessionId: this.session, cwd: this.cwd, readOnly: this.readOnly } : null; }
  async run(prompt, cwd, readOnly, runOptions = {}) {
    this.controller = new AbortController();
    const query = this.dependencies.query || (await import('@anthropic-ai/claude-agent-sdk')).query;
    if (this.controller.signal.aborted) throw new Error('Stopped.');
    if (this.cwd !== cwd) this.session = null;
    this.cwd = cwd; this.readOnly = readOnly;
    let answer = '', streamed = '', activeMessage = '', sawResult = false, review;
    const env = { ...process.env };
    // This app deliberately uses the CLI's subscription login, not API billing.
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
    this.query = query({ prompt, options: {
      cwd, pathToClaudeCodeExecutable: this.path, env,
      abortController: this.controller, includePartialMessages: true,
      ...(this.session ? { resume: this.session } : {}),
      permissionMode: 'default', settingSources: [],
      ...(runOptions.review ? { outputFormat: { type: 'json_schema', schema: {
        type: 'object', additionalProperties: false,
        properties: { needsChanges: { type: 'boolean' }, summary: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } },
        required: ['needsChanges', 'summary', 'findings']
      } } } : {}),
      allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      ...(readOnly ? { disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Agent', 'Task'] } : {}),
      canUseTool: async (tool, input, options) => {
        if (tool === 'AskUserQuestion') {
          const questions = input.questions || [];
          const result = await this.approval('claude', 'A quick question', questions.map(q => q.question).join('\n'), { kind: 'form', schema: questionSchema(questions), autoEligible: false });
          if (result.action !== 'accept') return { behavior: 'deny', message: 'The user declined to answer.' };
          return { behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(questions.map((question, index) => [question.question, result.content[question.id || String(index)]])) } };
        }
        if (readOnly) return { behavior: 'deny', message: 'This task is read-only. Use reading and search tools.' };
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
          if (event.type === 'content_block_start') {
            const block = event.content_block;
            const kind = activityKind(block.type === 'tool_use' ? block.name : block.type);
            if (block.type === 'thinking' || block.type === 'tool_use') this.emit('claude', LINES[kind], kind);
          }
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
            const kind = activityKind(block.name); this.emit('claude', LINES[kind], kind);
            this.emit('claude', `${block.name}: ${JSON.stringify(block.input)}`, 'tool', block.id);
          }
        }
        if (message.type === 'result') {
          sawResult = true;
          if (message.is_error || message.subtype !== 'success') throw new Error((message.errors || []).join('\n') || message.result || 'Claude could not finish the task. Check its sign-in and usage limits.');
          answer = message.result || answer || streamed;
          review = message.structured_output;
          if (runOptions.review && review) this.emit('claude', [review.summary, ...(review.findings || []).map(finding => `• ${finding}`)].join('\n'), 'message', `review-${message.uuid || Date.now()}`);
          // Result marks the completed turn. Background SDK messages may follow forever.
          break;
        }
      }
      if (!sawResult) throw new Error('Claude disconnected before reporting a completed turn. Retry the task to resume its saved session.');
      return runOptions.review ? { text: answer, review } : answer || 'Task completed.';
    } finally { this.query?.close?.(); this.query = null; }
  }
  async stop() { this.controller?.abort(); }
  close() { this.controller?.abort(); this.query?.close?.(); }
}

module.exports = { CodexAgent, ClaudeAgent, detectAgents, findExecutable };
