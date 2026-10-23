const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Coordinator } = require('../electron/coordinator.cjs');
const { LINES, activityKind } = require('../electron/activity.cjs');

function workspace(initial = {}, dependencies = {}) {
  const coordinator = new Coordinator({ project: '/project', ...initial }, dependencies);
  for (const name of ['codex', 'claude']) coordinator.state.agents[name] = { installed: true, signedIn: true, path: name };
  return coordinator;
}

test('legacy history migrates, new subjects preserve it, and reopening restores sessions', async () => {
  const restored = [];
  class Agent {
    restoreSession(value) { this.session = value; restored.push(value); }
    exportSession() { return this.session; }
    async run() { this.session = { threadId: 'saved-thread', cwd: '/project', readOnly: false }; return 'Done'; }
    close() { this.session = null; }
  }
  const coordinator = workspace({ events: [{ id: 'old', agent: 'you', text: 'Build a clock', kind: 'prompt', time: 1, streaming: true }] }, { codex: Agent });
  const oldId = coordinator.state.activeChatId;
  assert.equal(coordinator.state.chats[0].title, 'Build a clock');
  assert.equal(coordinator.state.events[0].streaming, false);
  await coordinator.start({ prompt: 'Add seconds', target: 'codex', mode: 'build' }); await coordinator.current;
  coordinator.setApprovalMode('auto');
  coordinator.fresh();
  assert.equal(coordinator.state.approvalMode, 'ask');
  assert.equal(coordinator.state.events.length, 0);
  coordinator.event('you', 'Plan a game', 'prompt');
  const saved = JSON.parse(JSON.stringify(coordinator.serialize()));
  const reopened = workspace(saved, { codex: Agent });
  reopened.selectChat(oldId);
  assert.equal(reopened.state.project, '/project');
  assert.ok(reopened.state.events.some(event => event.text === 'Add seconds'));
  reopened.client('codex');
  assert.equal(restored.at(-1).threadId, 'saved-thread');
  assert.equal(reopened.state.chats.length, 2);
  assert.equal(reopened.state.approvalMode, 'ask');
});

test('changing projects archives the previous subject and leaves its folder attached', () => {
  const coordinator = workspace(); coordinator.event('you', 'Old subject', 'prompt');
  const oldId = coordinator.state.activeChatId;
  coordinator.setProject('/another');
  assert.notEqual(coordinator.state.activeChatId, oldId);
  coordinator.selectChat(oldId); assert.equal(coordinator.state.project, '/project');
});

test('chat switching is rejected while work runs', async () => {
  let finish;
  class Slow { run() { return new Promise(resolve => { finish = resolve; }); } close() {} }
  const coordinator = workspace({}, { codex: Slow });
  await coordinator.start({ prompt: 'Wait', target: 'codex', mode: 'build' });
  assert.throws(() => coordinator.fresh(), /current task/);
  assert.throws(() => coordinator.selectChat(coordinator.state.activeChatId), /current task/);
  finish('Done'); await coordinator.current;
  assert.equal(coordinator.state.activity.codex, null);
});

test('activity describes tool events without filling the chat transcript', () => {
  const coordinator = workspace();
  for (const [tool, kind] of [['WebSearch', 'researching'], ['Read', 'reading'], ['Edit', 'editing'], ['Bash', 'running'], ['reasoning', 'thinking']]) {
    assert.equal(activityKind(tool), kind);
    coordinator.event('codex', LINES[kind], kind);
    assert.equal(coordinator.state.activity.codex.kind, kind);
  }
  assert.equal(coordinator.state.events.length, 0);
});

test('auto approval handles permissions but leaves questions and sign-in for the user', async () => {
  const coordinator = workspace();
  const pending = coordinator.ask('codex', 'Run tests', 'npm test');
  coordinator.setApprovalMode('auto'); assert.equal(await pending, true);
  assert.equal(await coordinator.ask('claude', 'Edit', 'file'), true);
  const input = { kind: 'form', schema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] } };
  assert.deepEqual(await coordinator.ask('codex', 'Confirm', '', input), { action: 'accept', content: { confirm: true } });
  const question = coordinator.ask('claude', 'Choose', '', { kind: 'form', autoEligible: false, schema: { type: 'object', properties: { choice: { enum: ['a', 'b'] } }, required: ['choice'] } });
  const item = coordinator.state.approvals[0];
  assert.throws(() => coordinator.answer(item.id, true, { choice: 'c' }), /allowed values/);
  assert.equal(coordinator.state.approvals.length, 1);
  coordinator.answer(item.id, true, { choice: 'b' });
  assert.deepEqual(await question, { action: 'accept', content: { choice: 'b' } });
  const url = coordinator.ask('codex', 'Authorize', '', { kind: 'url', url: 'https://example.com' });
  assert.equal(coordinator.state.approvals.length, 1);
  await coordinator.stop(); assert.deepEqual(await url, { action: 'decline' });
});

test('review findings return to the builder, and a clear verdict ends the loop', async () => {
  let builds = 0, reviews = 0;
  class Builder { async run(prompt) { builds++; if (builds === 2) assert.match(prompt, /Fix clock/); return 'Built'; } close() {} }
  class Reviewer { async run(_prompt, _cwd, readOnly, options) { assert.equal(readOnly, true); assert.equal(options.review, true); return { review: { needsChanges: ++reviews === 1, summary: 'Review', findings: ['Fix clock'] } }; } close() {} }
  const coordinator = workspace({}, { codex: Builder, claude: Reviewer });
  await coordinator.start({ prompt: 'Clock', target: 'both', mode: 'build' }); await coordinator.current;
  assert.equal(builds, 2); assert.equal(reviews, 2); assert.equal(coordinator.state.busy, false);
  assert.match(coordinator.state.events.at(-1).text, /review is clear/);
});

test('review repair loop stops after three passes with explicit remaining findings', async () => {
  let builds = 0;
  class Builder { async run() { builds++; return 'Built'; } close() {} }
  class Reviewer { async run() { return { review: { needsChanges: true, summary: 'Review', findings: ['Missing feature'] } }; } close() {} }
  const coordinator = workspace({}, { codex: Builder, claude: Reviewer });
  await coordinator.start({ prompt: 'Clock', target: 'both', mode: 'build' }); await coordinator.current;
  assert.equal(builds, 3); assert.match(coordinator.state.events.at(-1).text, /still has findings/);
});
