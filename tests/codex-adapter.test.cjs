const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexAgent } = require('../electron/agents.cjs');

for (const [readOnly, sandbox] of [[true, 'read-only'], [false, 'workspace-write']]) {
  test(`Codex thread/start uses the ${sandbox} wire value`, async () => {
    const client = new CodexAgent('unused', () => {}, async () => false);
    const calls = [];
    client.connect = async () => {};
    client.request = async (method, params) => {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'thread-test' } };
      if (method === 'turn/start') {
        setImmediate(() => client.onMessage({ method: 'turn/completed', params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed' } } }));
        return { turn: { id: 'turn-test' } };
      }
      throw new Error('Unexpected request');
    };
    await client.run('Connection test', '/project', readOnly);
    assert.equal(calls[0].method, 'thread/start');
    assert.equal(calls[0].params.sandbox, sandbox);
    assert.equal(calls[0].params.approvalPolicy, 'on-request');
  });
}
