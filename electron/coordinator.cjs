const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { CodexAgent, ClaudeAgent, detectAgents } = require('./agents.cjs');
const { assertTask } = require('./protocol.cjs');

class Coordinator extends EventEmitter {
  constructor(initial = {}, dependencies = {}) {
    super();
    this.state = {
      project: initial.project || null,
      events: Array.isArray(initial.events) ? initial.events.slice(-500) : [],
      appearance: { accent: 'mint', theme: 'light', pattern: true, fontSize: 14, ...(initial.appearance || {}) },
      agents: { codex: { installed: false, signedIn: false }, claude: { installed: false, signedIn: false } },
      status: { codex: 'idle', claude: 'idle' }, busy: false, approvals: []
    };
    this.dependencies = dependencies;
    this.clients = {}; this.approvals = new Map(); this.cancelledAgents = new Set(); this.generation = 0;
  }
  publish() { this.emit('state', this.state); }
  event(agent, text, kind = 'message', itemId) {
    if (!text) return;
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
    this.closeClients(); this.state.project = project; this.state.events = [];
    this.state.status = { codex: 'idle', claude: 'idle' };
    this.publish();
  }
  fresh() {
    if (this.state.busy) throw new Error('Stop the current task before starting a new session.');
    this.closeClients(); this.state.events = []; this.state.status = { codex: 'idle', claude: 'idle' }; this.publish();
  }
  ask(agent, title, detail) {
    if (this.cancelledAgents.has(agent) || this.cancelled) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise(resolve => {
      this.approvals.set(id, resolve);
      this.state.approvals.push({ id, agent, title, detail: detail.slice(0, 20000) });
      this.state.status[agent] = 'approval'; this.publish();
    });
  }
  answer(id, allow) {
    const resolve = this.approvals.get(id);
    if (!resolve) return;
    const approval = this.state.approvals.find(p => p.id === id);
    this.approvals.delete(id); this.state.approvals = this.state.approvals.filter(p => p.id !== id);
    if (approval && !this.state.approvals.some(p => p.agent === approval.agent)) this.state.status[approval.agent] = 'working';
    resolve(allow === true); this.publish();
  }
  client(agent) {
    if (!this.clients[agent]) {
      const Agent = this.dependencies[agent] || (agent === 'codex' ? CodexAgent : ClaudeAgent);
      this.clients[agent] = new Agent(this.state.agents[agent].path, (...args) => this.event(...args), (...args) => this.ask(...args));
    }
    return this.clients[agent];
  }
  async runOne(agent, prompt, readOnly) {
    if (this.cancelled || this.cancelledAgents.has(agent)) throw new Error('Stopped.');
    this.state.status[agent] = 'working'; this.publish();
    try {
      const result = await this.client(agent).run(prompt, this.state.project, readOnly);
      if (this.cancelled || this.cancelledAgents.has(agent)) throw new Error('Stopped.');
      this.state.status[agent] = 'done';
      return result;
    } catch (error) {
      const stopped = this.cancelled || this.cancelledAgents.has(agent) || error.name === 'AbortError' || error.message === 'Stopped.';
      this.state.status[agent] = stopped ? 'stopped' : 'error';
      this.event(agent, stopped ? 'Task stopped.' : error.message, stopped ? 'notice' : 'error');
      throw error;
    } finally {
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
      const result = await this.runOne('codex', context + task.prompt, false);
      if (this.cancelled || this.cancelledAgents.size) return;
      this.event('system', 'Codex → Claude: implementation ready for review.', 'handoff');
      await this.runOne('claude', context + `Review Codex's implementation of this user task. Read the actual files and report concrete bugs or missing requirements. This is a read-only review.\n\nTASK:\n${task.prompt}\n\nCODEX HANDOFF:\n${result.slice(0, 24000)}`, true);
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
  closeClients() { Object.values(this.clients).forEach(client => client.close()); this.clients = {}; }
  close() { this.cancelled = true; for (const item of [...this.state.approvals]) this.answer(item.id, false); this.closeClients(); }
}

module.exports = { Coordinator };
