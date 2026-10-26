const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { changes, fileDiff } = require('../electron/workspace.cjs');

test('Git preview shows new, staged, unstaged, renamed, and deleted files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cxc-git-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cxc-git-'));
    return fs.rm(root, { recursive: true, force: true });
  });
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
  git(['init']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'original\n');
  await fs.writeFile(path.join(root, 'delete.txt'), 'delete\n');
  await fs.writeFile(path.join(root, 'rename me.txt'), 'rename\n');
  git(['add', '.']); git(['commit', '-m', 'Initial']);
  git(['mv', 'rename me.txt', 'new name.txt']);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'staged\n'); git(['add', 'tracked.txt']);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'unstaged\n');
  await fs.unlink(path.join(root, 'delete.txt'));
  await fs.writeFile(path.join(root, 'untracked.txt'), 'new contents');
  const result = await changes(root);
  assert.equal(result.isGit, true);
  assert.deepEqual(result.files.map(f => f.path).sort(), ['delete.txt', 'new name.txt', 'tracked.txt', 'untracked.txt']);
  const diff = await fileDiff(root, 'tracked.txt');
  assert.match(diff, /STAGED/); assert.match(diff, /WORKING TREE/); assert.match(diff, /unstaged/);
  assert.match(await fileDiff(root, 'untracked.txt'), /new contents/);
  assert.match(await fileDiff(root, 'delete.txt'), /-delete/);
  await assert.rejects(fileDiff(root, '../outside.txt'), /outside/);
  await assert.rejects(fileDiff(root, 'not-changed.txt'), /changes list/);
});
test('a non-Git folder has an explicit empty state', async () => {
  assert.deepEqual(await changes(null), { files: [], isGit: false });
});
