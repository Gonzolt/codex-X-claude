const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Coordinator } = require('../electron/coordinator.cjs');
const { CodexAgent } = require('../electron/agents.cjs');

test('a closed agent cannot append messages or request approvals in another chat', async () => {
  let emit, approve;
  class LateAgent {
    constructor(_path, output, approval) { emit = output; approve = approval; }
    close() {}
  }
  const coordinator = new Coordinator({ project: '/project' }, { codex: LateAgent });
  coordinator.state.agents.codex.path = 'unused'; coordinator.client('codex');
  coordinator.event('you', 'Old subject', 'prompt'); coordinator.fresh();
  emit('codex', 'Late answer from the old chat', 'message', 'old');
  assert.equal(coordinator.state.events.length, 0);
  assert.equal(await approve('codex', 'Late command', 'touch file'), false);
  assert.equal(coordinator.state.approvals.length, 0);
  coordinator.close();
});

test('stopping Codex settles a turn even when completion notification never arrives', { timeout: 1000 }, async () => {
  let killed = false;
  const client = new CodexAgent('unused', () => {}, async () => false, { stopGraceMs: 10 });
  client.child = { stdin: { destroy() {} }, kill() { killed = true; } };
  client.thread = 'test-thread'; client.turn = 'test-turn';
  client.request = async () => ({});
  const turn = new Promise((resolve, reject) => { client.waiter = { resolve, reject }; });
  const rejected = assert.rejects(turn, /Stopped/);
  await client.stop(); await rejected;
  assert.equal(killed, true); assert.equal(client.child, null);
});
