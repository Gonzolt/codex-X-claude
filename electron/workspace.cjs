const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

async function changes(cwd) {
  if (!cwd) return { files: [], isGit: false };
  try {
    const { stdout } = await exec('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000 });
    const entries = stdout.split('\0').filter(Boolean), files = [];
    for (let i = 0; i < entries.length; i++) {
      const status = entries[i].slice(0, 2), name = entries[i].slice(3);
      files.push({ path: name, status: status.trim() || 'M' });
      if (/[RC]/.test(status)) i++; // porcelain -z puts the original name after the destination.
    }
    return { files: files.slice(0, 200), isGit: true };
  } catch { return { files: [], isGit: false }; }
}

async function fileDiff(cwd, name) {
  if (!cwd || typeof name !== 'string' || !name || name.length > 2000) throw new Error('Choose a file from the changes list.');
  const root = await fs.realpath(cwd);
  const candidate = path.resolve(root, name);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File is outside the selected project.');
  try {
    const real = await fs.realpath(candidate);
    const realRelative = path.relative(root, real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Linked file is outside the project.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await changes(cwd);
  const entry = result.files.find(file => file.path === name);
  if (!entry) throw new Error('This file is no longer in the changes list.');
  if (entry.status === '??') {
    const info = await fs.stat(candidate);
    if (info.size > 250000) return 'This file is too large to preview.';
    const data = await fs.readFile(candidate);
    if (data.includes(0)) return 'Binary file — preview unavailable.';
    return `New file: ${name}\n\n${data.toString('utf8')}`;
  }
  const options = { cwd, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 };
  const [unstaged, staged] = await Promise.all([
    exec('git', ['diff', '--no-ext-diff', '--no-textconv', '--', name], options),
    exec('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', name], options)
  ]);
  return [staged.stdout && `STAGED\n${staged.stdout}`, unstaged.stdout && `WORKING TREE\n${unstaged.stdout}`].filter(Boolean).join('\n') || 'No text diff available.';
}

module.exports = { changes, fileDiff };
