const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MotionEditor } = require('../electron/editor.cjs');
const { Coordinator } = require('../electron/coordinator.cjs');

function fixture(dependencies = {}) {
  const calls = [];
  class Codex {
    constructor(_path, emit) { this.emit = emit; }
    async run(prompt, cwd, readOnly) { calls.push({ agent: 'codex', prompt, cwd, readOnly }); this.emit('codex', 'Edited the selected film.', 'message', 'one'); return 'Changed the film.'; }
    close() {} stop() {}
  }
  class Claude {
    async run(prompt, cwd, readOnly, options) { calls.push({ agent: 'claude', prompt, cwd, readOnly }); return options?.review ? { review: { needsChanges: false, summary: 'Clear', findings: [] } } : 'Edited with Claude.'; }
    close() {} stop() {}
  }
  const coding = new Coordinator({ project: '/coding' });
  coding.state.agents = { codex: { installed: true, path: 'codex' }, claude: { installed: true, path: 'claude' } };
  const studios = { state: { editing: { root: '/motionkit', films: [{ id: 'lab/demo' }] } }, refreshFilms: async () => {} };
  const editor = new MotionEditor({}, { codex: Codex, claude: Claude, ...dependencies });
  return { coding, studios, editor, calls };
}
for (const target of ['codex', 'claude', 'both']) test(`editing request routes to ${target} in MotionKit, independently of coding history`, async () => {
  const { coding, studios, editor, calls } = fixture(); coding.event('you', 'Coding subject', 'prompt');
  await editor.start({ prompt: 'Make the title faster', target, film: 'lab/demo' }, studios, coding);
  await editor.coordinator.current;
  assert.deepEqual(calls.map(call => call.agent), target === 'both' ? ['codex', 'claude'] : [target]);
  assert.ok(calls.every(call => call.cwd === '/motionkit'));
  assert.match(calls[0].prompt, /brands\/lab\/films\/demo.html/); assert.match(calls[0].prompt, /Make the title faster/);
  assert.equal(calls[0].readOnly, false);
  if (target === 'both') assert.equal(calls[1].readOnly, true);
  assert.deepEqual(coding.state.events.map(event => event.text), ['Coding subject']);
  assert.equal(editor.state.events.find(event => event.agent === 'you').text, 'Make the title faster');
  assert.equal(coding.state.project, '/coding'); assert.equal(coding.state.busy, false);
});
test('editing rejects stale film choices, missing projects and concurrent coding tasks', async () => {
  const { coding, studios, editor, calls } = fixture();
  const input = { prompt: 'Edit it', target: 'codex', film: 'elsewhere/wrong' };
  await assert.rejects(editor.start(input, studios, coding), /Choose a film/);
  coding.state.busy = true; await assert.rejects(editor.start({ ...input, film: null }, studios, coding), /coding task/);
  coding.state.busy = false; studios.state.editing.root = null;
  await assert.rejects(editor.start({ ...input, film: null }, studios, coding), /MotionKit folder/);
  assert.equal(calls.length, 0);
});
test('editing approval and draft state stay separate from coding permissions and chats', async () => {
  const { coding, studios, editor } = fixture(); editor.attach(studios.state.editing.root);
  editor.coordinator.setDraft(editor.state.activeChatId, 'Unsent edit');
  editor.coordinator.setApprovalMode('auto');
  assert.equal(coding.state.approvalMode, 'ask'); assert.equal(coding.state.draft, '');
  editor.coordinator.setApprovalMode('ask');
  const permission = editor.coordinator.ask('claude', 'Edit film', 'Change file');
  const id = editor.state.approvals[0].id;
  coding.answer(id, true); assert.equal(editor.state.approvals.length, 1);
  editor.coordinator.answer(id, true); assert.equal(await permission, true);
  const saved = JSON.parse(JSON.stringify(editor.serialize()));
  const reopened = new MotionEditor(saved); reopened.select(editor.state.activeChatId, '/motionkit');
  assert.equal(reopened.state.draft, 'Unsent edit');
  assert.throws(() => reopened.select(editor.state.activeChatId, '/different'), /selected MotionKit/);
});
