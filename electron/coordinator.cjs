const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { CodexAgent, ClaudeAgent, detectAgents } = require('./agents.cjs');
const { assertTask } = require('./protocol.cjs');
const { validateInput, automaticConsent } = require('./inputs.cjs');
const { LINES } = require('./activity.cjs');

class Coordinator extends EventEmitter {
  static launch(initial = {}, dependencies = {}) {
    const coordinator = new Coordinator(initial, dependencies);
    if (initial.chats?.length || initial.events?.length) coordinator.fresh();
    return coordinator;
  }
  constructor(initial = {}, dependencies = {}) {
    super();
    this.chats = Array.isArray(initial.chats) ? initial.chats.filter(chat => chat && typeof chat.id === 'string' && Array.isArray(chat.events)).map(chat => ({ ...chat, draft: typeof chat.draft === 'string' ? chat.draft.slice(0, 32000) : '', events: chat.events.slice(-500).map(event => ({ ...event, streaming: false })), sessions: chat.sessions || {} })) : [];
    if (!this.chats.length) this.chats.push({ id: randomUUID(), title: 'New chat', project: initial.project || null, events: (initial.events || []).slice(-500).map(event => ({ ...event, streaming: false })), updatedAt: Date.now(), sessions: {} });
    const active = this.chats.find(chat => chat.id === initial.activeChatId) || this.chats[0];
    for (const chat of this.chats) if (chat.title === 'New chat') chat.title = chat.events.find(event => event.agent === 'you')?.text.split('\n')[0].slice(0, 65) || 'New chat';
    this.state = {
      project: active.project || null, events: active.events, draft: active.draft || '',
      activeChatId: active.id, chats: [], activity: { codex: null, claude: null },
      appearance: { accent: 'mint', theme: 'light', pattern: true, fontSize: 14, ...(initial.appearance || {}) },
      agents: { codex: { installed: false, signedIn: false }, claude: { installed: false, signedIn: false } },
      status: { codex: 'idle', claude: 'idle' }, busy: false, approvals: [],
      approvalMode: 'ask', reviewPass: 0, reviewLimit: 3
    };
    this.dependencies = dependencies;
    this.clients = {}; this.approvals = new Map(); this.cancelledAgents = new Set(); this.generation = 0;
    this.checkpoint();
  }
  checkpoint() {
    const chat = this.chats.find(chat => chat.id === this.state.activeChatId);
    chat.project = this.state.project; chat.events = this.state.events; chat.draft = this.state.draft;
    for (const [name, client] of Object.entries(this.clients)) {
      const session = client.exportSession?.();
      if (session) chat.sessions[name] = session;
    }
    this.state.chats = [...this.chats].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, project, updatedAt, events }) => ({ id, title, project, updatedAt, messageCount: events.filter(event => event.agent === 'you').length }));
  }
  serialize() {
    this.checkpoint();
    return { appearance: this.state.appearance, activeChatId: this.state.activeChatId, chats: this.chats.map(chat => ({ ...chat, events: chat.events.filter(event => event.kind !== 'output').map(event => ({ ...event, streaming: false })) })) };
  }
  publish() { this.checkpoint(); this.emit('state', this.state); }
  event(agent, text, kind = 'message', itemId) {
    if (!text) return;
    if (Object.hasOwn(LINES, kind) && ['codex', 'claude'].includes(agent)) {
      this.state.activity[agent] = { kind, text }; this.publish(); return;
    }
    if (kind === 'delta') this.state.activity[agent] = { kind: 'writing', text: LINES.writing };
    const chat = this.chats.find(chat => chat.id === this.state.activeChatId);
    chat.updatedAt = Date.now();
    if (agent === 'you' && !this.state.events.some(event => event.agent === 'you')) chat.title = text.trim().split('\n')[0].slice(0, 65) || 'New chat';
    const key = itemId ? `${agent}:${itemId}:${kind === 'delta' || kind === 'message' ? 'message' : kind}` : null;
    const previous = key && this.state.events.find(e => e.key === key);
    if (previous) {
      previous.text = (kind === 'delta' || kind === 'output' ? previous.text + text : text).slice(-100000);
      previous.streaming = kind === 'delta';
    } else this.state.events.push({ id: randomUUID(), key, agent, text: text.slice(-100000), kind: kind === 'delta' ? 'message' : kind, streaming: kind === 'delta', time: Date.now() });
    this.state.events = this.state.events.slice(-500);
    this.publish();
  }
  async refresh() {
    if (this.state.busy) throw new Error('Wait for the current task to finish before refreshing connections.');
    this.state.agents = await (this.dependencies.detectAgents || detectAgents)();
    this.publish(); return this.state;
  }
  setProject(project) {
    if (this.state.busy) throw new Error('Stop the current task before switching projects.');
    if (this.state.events.length) this.fresh();
    else this.closeClients();
    this.state.project = project;
    this.publish();
  }
  fresh() {
    if (this.state.busy) throw new Error('Wait for the current task before starting a new chat.');
    this.closeClients();
    const chat = { id: randomUUID(), title: 'New chat', project: this.state.project, draft: '', events: [], updatedAt: Date.now(), sessions: {} };
    this.chats.push(chat); this.loadChat(chat); return this.state;
  }
  selectChat(id) {
    if (this.state.busy) throw new Error('Wait for the current task before switching chats.');
    const chat = this.chats.find(chat => chat.id === id);
    if (!chat) throw new Error('This saved chat could not be found.');
    this.closeClients(); this.loadChat(chat); return this.state;
  }
  loadChat(chat) {
    this.state.activeChatId = chat.id; this.state.project = chat.project; this.state.events = chat.events; this.state.draft = chat.draft || '';
    this.state.approvalMode = 'ask'; this.state.reviewPass = 0; this.state.activity = { codex: null, claude: null };
    this.state.status = { codex: 'idle', claude: 'idle' }; this.cancelled = false; this.cancelledAgents.clear(); this.publish();
  }
  setDraft(id, value) {
    if (typeof value !== 'string' || value.length > 32000) throw new Error('Keep the draft under 32,000 characters.');
    const chat = this.chats.find(item => item.id === id);
    if (!chat) throw new Error('This saved chat could not be found.');
    chat.draft = value;
    if (id === this.state.activeChatId) this.state.draft = value;
    this.publish();
  }
  setApprovalMode(mode) {
    if (!['ask', 'auto'].includes(mode)) throw new Error('Choose ask or auto approval.');
    this.state.approvalMode = mode;
    if (mode === 'auto' && !this.cancelled) for (const item of [...this.state.approvals]) {
      if (this.cancelledAgents.has(item.agent)) continue;
      const content = item.kind === 'permission' ? {} : automaticConsent(item);
      if (content !== null) this.answer(item.id, true, content);
    }
    this.event('system', mode === 'auto' ? 'Auto-approve enabled for this session. Tool commands and edits will not wait for confirmation.' : 'Ask-before-approval enabled.', 'notice');
    this.publish();
  }
  ask(agent, title, detail, input) {
    if (this.cancelledAgents.has(agent) || this.cancelled) return Promise.resolve(input ? { action: 'decline' } : false);
    if (this.state.approvalMode === 'auto') {
      const content = input ? automaticConsent(input) : {};
      if (content !== null) {
        this.event(agent, `Auto-approved: ${title}`, 'notice');
        return Promise.resolve(input ? { action: 'accept', content } : true);
      }
    }
    const id = randomUUID();
    return new Promise(resolve => {
      this.approvals.set(id, resolve);
      this.state.approvals.push({ ...input, id, agent, title, detail: detail.slice(0, 20000), kind: input?.kind || 'permission' });
      this.state.status[agent] = 'approval'; this.publish();
    });
  }
  answer(id, allow, content) {
    const resolve = this.approvals.get(id);
    if (!resolve) return;
    const approval = this.state.approvals.find(p => p.id === id);
    if (allow === true && approval?.kind === 'form') validateInput(approval.schema, content);
    this.approvals.delete(id); this.state.approvals = this.state.approvals.filter(p => p.id !== id);
    if (approval && this.state.status[approval.agent] === 'approval' && !this.state.approvals.some(p => p.agent === approval.agent)) this.state.status[approval.agent] = 'working';
    resolve(approval?.kind === 'permission' ? allow === true : { action: allow === true ? 'accept' : 'decline', ...(allow === true && approval?.kind === 'form' ? { content } : {}) }); this.publish();
  }
  client(agent) {
    if (!this.clients[agent]) {
      const Agent = this.dependencies[agent] || (agent === 'codex' ? CodexAgent : ClaudeAgent);
      const chatId = this.state.activeChatId;
      let client;
      const active = () => client && this.clients[agent] === client && this.state.activeChatId === chatId;
      client = new Agent(this.state.agents[agent].path,
        (...args) => { if (active()) this.event(...args); },
        (...args) => active() ? this.ask(...args) : Promise.resolve(args[3] ? { action: 'decline' } : false));
      this.clients[agent] = client;
      this.clients[agent].restoreSession?.(this.chats.find(chat => chat.id === this.state.activeChatId).sessions[agent]);
    }
    return this.clients[agent];
  }
  async runOne(agent, prompt, readOnly, options = {}) {
    if (this.cancelled || this.cancelledAgents.has(agent)) throw new Error('Stopped.');
    this.state.status[agent] = 'working'; this.state.activity[agent] = { kind: 'thinking', text: LINES.thinking }; this.publish();
    try {
      const result = await this.client(agent).run(prompt, this.state.project, readOnly, options);
      if (this.cancelled || this.cancelledAgents.has(agent)) throw new Error('Stopped.');
      this.state.status[agent] = 'done';
      return result;
    } catch (error) {
      const stopped = this.cancelled || this.cancelledAgents.has(agent) || error.name === 'AbortError' || error.message === 'Stopped.';
      this.state.status[agent] = stopped ? 'stopped' : 'error';
      this.event(agent, stopped ? 'Task stopped.' : error.message, stopped ? 'notice' : 'error');
      throw error;
    } finally {
      this.state.activity[agent] = null;
      for (const item of [...this.state.approvals]) if (item.agent === agent) this.answer(item.id, false);
      for (const event of this.state.events) if (event.agent === agent) event.streaming = false;
      this.publish();
    }
  }
  async start(input) {
    const task = assertTask(input);
    if (this.state.busy) throw new Error('There is already a task running.');
    if (!this.state.project) throw new Error('Open a project folder first.');
    const targets = task.target === 'both' ? ['codex', 'claude'] : [task.target];
    for (const agent of targets) if (!this.state.agents[agent].installed) throw new Error(`${agent === 'codex' ? 'Codex' : 'Claude Code'} is not installed. Open connections for setup.`);
    this.state.busy = true; this.cancelled = false; this.cancelledAgents.clear();
    this.state.status = { codex: 'idle', claude: 'idle' };
    this.state.reviewPass = 0;
    this.state.draft = '';
    this.event('you', task.prompt, 'prompt');
    const generation = ++this.generation;
    // Keep IPC responsive while the agents work and approvals are pending.
    this.current = this.execute(task).catch(() => {}).finally(() => {
      if (generation === this.generation) {
        this.state.busy = false;
        for (const agent of ['codex', 'claude']) if (this.state.status[agent] === 'waiting') this.state.status[agent] = 'idle';
        this.publish();
      }
    });
    return this.state;
  }
  async execute(task) {
    const context = 'You are working inside Codex x Claude, a local desktop workspace. Stay focused on the user task. Do not commit, push, publish, or deploy unless explicitly requested.\n\n';
    if (task.target !== 'both') {
      await this.runOne(task.target, context + task.prompt, task.mode === 'compare');
    } else if (task.mode === 'compare') {
      this.event('system', 'Both agents are exploring the same task in read-only mode.', 'handoff');
      await Promise.allSettled(['codex', 'claude'].map(agent => this.runOne(agent, context + 'Read-only investigation: propose a plan and call out risks. Do not change files or request elevated write access.\n\n' + task.prompt, true)));
    } else {
      this.state.status.claude = 'waiting';
      this.event('system', 'Codex builds → Claude reviews. One writer, one shared project.', 'handoff');
      let implementationPrompt = context + task.prompt;
      for (let pass = 1; pass <= this.state.reviewLimit; pass++) {
        if (this.cancelled || this.cancelledAgents.size) return;
        this.state.reviewPass = pass; this.state.status.claude = 'waiting'; this.publish();
        const result = await this.runOne('codex', implementationPrompt, false);
        if (this.cancelled || this.cancelledAgents.size) return;
        this.event('system', `Codex → Claude: review ${pass}/${this.state.reviewLimit}.`, 'handoff');
        const review = await this.runOne('claude', context + `Review Codex's implementation of this user task. Read the actual files. Report concrete bugs or missing requirements in the structured verdict. Set needsChanges to true only for actionable issues in the requested scope. This is a read-only review.\n\nTASK:\n${task.prompt}\n\nCODEX HANDOFF:\n${String(result).slice(0, 24000)}`, true, { review: true });
        if (this.cancelled || this.cancelledAgents.size) return;
        if (!review?.review || typeof review.review.needsChanges !== 'boolean') {
          this.event('system', 'Review finished without a structured verdict. Check Claude’s response before continuing.', 'notice'); return;
        }
        if (!review.review.needsChanges) {
          this.event('system', 'Claude’s review is clear. Build + review finished.', 'handoff'); return;
        }
        if (pass === this.state.reviewLimit) {
          this.event('system', 'Three review passes finished; Claude still has findings. Send a follow-up task to continue.', 'notice'); return;
        }
        this.event('system', 'Claude → Codex: fixing review findings, then reviewing again.', 'handoff');
        implementationPrompt = context + `Continue the original task and fix these review findings. Inspect the actual code, make the necessary changes, and run relevant checks.\n\nTASK:\n${task.prompt}\n\nCLAUDE REVIEW:\n${JSON.stringify(review.review).slice(0, 24000)}`;
      }
    }
  }
  async stop(agent) {
    if (agent !== undefined && !['codex', 'claude'].includes(agent)) throw new Error('Unknown agent.');
    if (!agent) this.cancelled = true;
    const targets = agent ? [agent] : ['codex', 'claude'];
    targets.forEach(name => this.cancelledAgents.add(name));
    for (const item of [...this.state.approvals]) if (targets.includes(item.agent)) this.answer(item.id, false);
    await Promise.allSettled(targets.map(name => this.clients[name]?.stop()));
    // Stop a waiting review too, even when its implementation hasn't finished.
    for (const name of targets) if (this.state.status[name] === 'waiting') this.state.status[name] = 'stopped';
    this.publish();
  }
  closeClients() { this.checkpoint(); Object.values(this.clients).forEach(client => client.close()); this.clients = {}; }
  close() { this.cancelled = true; for (const item of [...this.state.approvals]) this.answer(item.id, false); this.closeClients(); }
}

module.exports = { Coordinator };
