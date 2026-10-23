const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Coordinator } = require('../electron/coordinator.cjs');
const { JsonLines, assertTask } = require('../electron/protocol.cjs');

function fixture(overrides = {}) {
  const calls = [];
  class Codex {
    constructor(_path, emit) { this.emit = emit; }
    async run(prompt, cwd, readOnly) { calls.push({ agent: 'codex', prompt, cwd, readOnly }); this.emit('codex', 'Built the feature.', 'message', 'c1'); return 'Implementation summary.'; }
    stop() {} close() {}
  }
  class Claude {
    constructor(_path, emit) { this.emit = emit; }
    async run(prompt, cwd, readOnly) { calls.push({ agent: 'claude', prompt, cwd, readOnly }); this.emit('claude', 'Review complete.', 'message', 'a1'); return 'Reviewed.'; }
    stop() {} close() {}
  }
  const coordinator = new Coordinator({ project: '/project' }, { codex: Codex, claude: Claude, ...overrides });
  coordinator.state.agents = { codex: { installed: true, path: 'codex' }, claude: { installed: true, path: 'claude' } };
  return { coordinator, calls };
}

test('JSON lines survive split chunks and multiple messages', () => {
  const parser = new JsonLines(), messages = [];
  parser.on('message', message => messages.push(message));
  parser.push('{"method":"turn/'); parser.push('completed"}\r\n\n{"id":2}\n');
  assert.deepEqual(messages, [{ method: 'turn/completed' }, { id: 2 }]);
});
test('malformed JSON does not swallow the next valid message', () => {
  const parser = new JsonLines(), messages = []; let invalid = 0;
  parser.on('invalid', () => invalid++); parser.on('message', message => messages.push(message));
  parser.push('invalid\n{"id":3}\n');
  assert.equal(invalid, 1); assert.deepEqual(messages, [{ id: 3 }]);
});
test('task validation rejects empty prompts, invalid targets, and oversized input', () => {
  for (const task of [null, {}, { prompt: ' ' }, { prompt: 'test', target: 'shell', mode: 'build' }, { prompt: 'x'.repeat(32001), target: 'both', mode: 'build' }]) assert.throws(() => assertTask(task));
});
test('build + review passes real implementation output to a read-only reviewer', async () => {
  const { coordinator, calls } = fixture();
  await coordinator.start({ prompt: 'Add login', target: 'both', mode: 'build' });
  await coordinator.current;
  assert.deepEqual(calls.map(c => [c.agent, c.readOnly]), [['codex', false], ['claude', true]]);
  assert.match(calls[1].prompt, /Implementation summary/);
  assert.match(calls[1].prompt, /Add login/);
  assert.equal(coordinator.state.busy, false);
  assert.equal(coordinator.state.status.claude, 'done');
  coordinator.close();
});
test('parallel exploration starts both agents before either finishes and denies writes', async () => {
  const started = [], release = [];
  class Slow { constructor(path) { this.name = path; } run(_prompt, _cwd, readOnly) { assert.equal(readOnly, true); started.push(this.name); return new Promise(resolve => release.push(resolve)); } close() {} }
  const { coordinator } = fixture({ codex: Slow, claude: Slow });
  await coordinator.start({ prompt: 'Explore login', target: 'both', mode: 'compare' });
  assert.deepEqual(started, ['codex', 'claude']);
  release.forEach(resolve => resolve('Done'));
  await coordinator.current;
  assert.equal(coordinator.state.busy, false);
});
test('an implementation failure never starts the review', async () => {
  class Broken { async run() { throw new Error('Not signed in.'); } close() {} }
  const { coordinator, calls } = fixture({ codex: Broken });
  await coordinator.start({ prompt: 'Add login', target: 'both', mode: 'build' });
  await coordinator.current;
  assert.equal(calls.length, 0);
  assert.equal(coordinator.state.status.codex, 'error');
  assert.equal(coordinator.state.busy, false);
  assert.ok(coordinator.state.events.some(event => event.text === 'Not signed in.'));
});
test('stopping an implementation cancels its pending approval and skips review', async () => {
  class Waiting {
    constructor(_path, _emit, approval) { this.approval = approval; }
    async run() { return await this.approval('codex', 'Run command', 'npm test') ? 'Allowed' : 'Denied'; }
    stop() {} close() {}
  }
  const { coordinator, calls } = fixture({ codex: Waiting });
  await coordinator.start({ prompt: 'Add login', target: 'both', mode: 'build' });
  assert.equal(coordinator.state.approvals.length, 1);
  await coordinator.stop('codex'); await coordinator.current;
  assert.equal(coordinator.state.approvals.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(coordinator.state.status.codex, 'stopped');
});
test('an approval is granted only by an explicit boolean true', async () => {
  const { coordinator } = fixture();
  const result = coordinator.ask('claude', 'Bash', 'npm test');
  coordinator.answer(coordinator.state.approvals[0].id, 'true');
  assert.equal(await result, false);
  assert.equal(coordinator.state.approvals.length, 0);
});
test('streaming text is replaced by the final message without duplication', () => {
  const { coordinator } = fixture();
  coordinator.event('codex', 'Hel', 'delta', '1');
  coordinator.event('codex', 'lo', 'delta', '1');
  coordinator.event('codex', 'Hello', 'message', '1');
  assert.equal(coordinator.state.events.length, 1);
  assert.equal(coordinator.state.events[0].text, 'Hello');
  assert.equal(coordinator.state.events[0].streaming, false);
});
test('switching projects or starting another task during work is rejected', async () => {
  let finish;
  class Slow { run() { return new Promise(resolve => { finish = resolve; }); } close() {} }
  const { coordinator } = fixture({ codex: Slow });
  await coordinator.start({ prompt: 'One', target: 'codex', mode: 'build' });
  assert.throws(() => coordinator.setProject('/another'));
  await assert.rejects(coordinator.start({ prompt: 'Two', target: 'codex', mode: 'build' }));
  finish('Done'); await coordinator.current;
});
test('missing CLI and missing project fail before a task starts', async () => {
  const { coordinator } = fixture();
  coordinator.state.project = null;
  await assert.rejects(coordinator.start({ prompt: 'One', target: 'codex', mode: 'build' }), /project folder/);
  coordinator.state.project = '/project'; coordinator.state.agents.claude.installed = false;
  await assert.rejects(coordinator.start({ prompt: 'One', target: 'both', mode: 'build' }), /not installed/);
  assert.equal(coordinator.state.busy, false);
});
