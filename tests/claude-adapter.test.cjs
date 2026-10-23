const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClaudeAgent } = require('../electron/agents.cjs');

test('Claude completes at the result instead of waiting for background messages', async () => {
  let options, closed = false;
  async function* messages() {
    yield { type: 'result', session_id: 'continued-session', subtype: 'success', result: 'Ready' };
    throw new Error('Background messages must not keep the turn open');
  }
  const client = new ClaudeAgent('unused', () => {}, () => false, { query: input => { options = input.options; const stream = messages(); stream.close = () => { closed = true; }; return stream; } });
  client.restoreSession({ sessionId: 'existing-session', cwd: '/project', readOnly: true });
  assert.equal(await client.run('Continue', '/project', false), 'Ready');
  assert.equal(options.resume, 'existing-session');
  assert.equal(client.exportSession().sessionId, 'continued-session');
  assert.equal(closed, true);
});

test('Claude disconnection without a result is an error, not false completion', async () => {
  const client = new ClaudeAgent('unused', () => {}, () => false, { query: () => (async function* () { yield { type: 'system', session_id: 'unfinished' }; })() });
  await assert.rejects(client.run('Task', '/project', true), /before reporting a completed turn/);
});

test('structured Claude review stays read-only and returns its verdict', async () => {
  const verdict = { needsChanges: true, summary: 'Fix needed', findings: ['Clock stopped'] };
  let options;
  const client = new ClaudeAgent('unused', () => {}, () => false, { query: input => { options = input.options; return (async function* () { yield { type: 'result', subtype: 'success', structured_output: verdict }; })(); } });
  const result = await client.run('Review', '/project', true, { review: true });
  assert.deepEqual(result.review, verdict);
  assert.equal(options.outputFormat.type, 'json_schema');
  assert.ok(options.disallowedTools.includes('Write'));
});
