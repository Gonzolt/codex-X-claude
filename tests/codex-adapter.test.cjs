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

test('Codex resumes the saved native thread when reopening a chat', async () => {
  const client = new CodexAgent('unused', () => {}, async () => false);
  client.restoreSession({ threadId: 'saved-thread', cwd: '/project', readOnly: true });
  client.connect = async () => {};
  client.request = async (method, params) => {
    if (method === 'thread/resume') { assert.equal(params.threadId, 'saved-thread'); assert.equal(params.sandbox, 'workspace-write'); return { thread: { id: 'saved-thread' } }; }
    assert.equal(method, 'turn/start');
    setImmediate(() => client.onMessage({ method: 'turn/completed', params: { threadId: 'saved-thread', turn: { status: 'completed' } } }));
    return { turn: { id: 'next-turn' } };
  };
  await client.run('Continue', '/project', false);
  assert.equal(client.exportSession().threadId, 'saved-thread');
});

test('Codex MCP input and real questions receive protocol responses', async () => {
  const sent = [], asked = [];
  const client = new CodexAgent('unused', () => {}, async (...args) => { asked.push(args); return { action: 'accept', content: { preference: 'mint' } }; });
  client.child = {}; client.send = message => sent.push(message);
  await client.onMessage({ id: 1, method: 'mcpServer/elicitation/request', params: { mode: 'form', message: 'Choose', requestedSchema: { type: 'object', properties: { preference: { type: 'string' } } } } });
  assert.equal(asked[0][3].kind, 'form'); assert.deepEqual(sent[0].result.content, { preference: 'mint' });
  await client.onMessage({ id: 2, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'preference', question: 'Accent?', options: [{ label: 'mint' }] }] } });
  assert.equal(asked[1][3].autoEligible, false); assert.deepEqual(sent[1].result.answers.preference.answers, ['mint']);
});
