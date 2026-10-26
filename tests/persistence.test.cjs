const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkspaceStore } = require('../electron/persistence.cjs');
const { Coordinator } = require('../electron/coordinator.cjs');

test('each launch opens a new chat and preserves previous history, drafts and sessions', () => {
  const first = Coordinator.launch({ project: '/project' });
  assert.equal(first.state.chats.length, 1);
  first.event('you', 'A previous subject', 'prompt');
  first.setDraft(first.state.activeChatId, 'My unsent follow-up');
  const oldId = first.state.activeChatId;
  first.chats[0].sessions = { codex: { threadId: 'saved-native-thread', cwd: '/project' } };
  const reopened = Coordinator.launch(JSON.parse(JSON.stringify(first.serialize())));
  assert.notEqual(reopened.state.activeChatId, oldId);
  assert.equal(reopened.state.chats.length, 2);
  assert.equal(reopened.state.project, '/project');
  assert.equal(reopened.state.events.length, 0); assert.equal(reopened.state.draft, '');
  assert.deepEqual(reopened.chats.find(chat => chat.id === reopened.state.activeChatId).sessions, {});
  reopened.selectChat(oldId);
  assert.equal(reopened.state.draft, 'My unsent follow-up');
  assert.equal(reopened.state.events[0].text, 'A previous subject');
  assert.equal(reopened.chats.find(chat => chat.id === oldId).sessions.codex.threadId, 'saved-native-thread');
});

test('legacy history also stays available when starting a fresh launch', () => {
  const coordinator = Coordinator.launch({ project: '/project', events: [{ id: 'legacy', agent: 'you', text: 'Old history', kind: 'prompt', time: 1 }] });
  assert.equal(coordinator.state.chats.length, 2); assert.equal(coordinator.state.events.length, 0);
  const old = coordinator.chats.find(chat => chat.events.length);
  coordinator.selectChat(old.id); assert.equal(coordinator.state.events[0].text, 'Old history');
});

test('a delayed draft update cannot replace another chat draft', () => {
  const coordinator = Coordinator.launch(); const previous = coordinator.state.activeChatId;
  coordinator.fresh(); coordinator.setDraft(coordinator.state.activeChatId, 'Current draft');
  coordinator.setDraft(previous, 'Delayed previous draft');
  assert.equal(coordinator.state.draft, 'Current draft');
  coordinator.selectChat(previous); assert.equal(coordinator.state.draft, 'Delayed previous draft');
});

test('queued saves finish in order and a failed save preserves the previous file', async t => {
  const cache = path.resolve(__dirname, '../.cache'); await fs.mkdir(cache, { recursive: true });
  const root = await fs.mkdtemp(path.join(cache, 'persistence-test-'));
  t.after(async () => { assert.equal(path.dirname(root), cache); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'workspace.json'), store = new WorkspaceStore(file);
  await Promise.all([store.save({ draft: 'one' }), store.save({ draft: 'last keystroke' })]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { draft: 'last keystroke' });
  let fail = true;
  const broken = new WorkspaceStore(file, { ...fs, rename: (...args) => fail ? Promise.reject(new Error('Disk unavailable')) : fs.rename(...args) });
  await assert.rejects(broken.save({ draft: 'should not replace good save' }), /Disk unavailable/);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { draft: 'last keystroke' });
  fail = false; await broken.save({ draft: 'retry succeeded' });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { draft: 'retry succeeded' });
});
