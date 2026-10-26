// Runs the production renderer in an isolated Electron profile. No agent turns are started.
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setTimeout: pause } = require('node:timers/promises');

const root = path.resolve(__dirname, '../.cache/smoke-' + Date.now());
const live = process.argv.includes('--live-faceless');
process.argv.push('--headless-test'); process.env.CXC_TEST_USER_DATA = path.join(root, 'profile');
let finished = false, win;
app.on('before-quit', event => { if (!finished) event.preventDefault(); });
const dialogs = [], opened = [], external = [];
dialog.showOpenDialog = async () => ({ canceled: !dialogs.length, filePaths: dialogs.length ? [dialogs.shift()] : [] });
dialog.showMessageBoxSync = () => 1;
shell.openExternal = async url => { external.push(url); };
shell.openPath = async file => { opened.push(file); return ''; };
require('../electron/agents.cjs').detectAgents = async () => ({ codex: { installed: false, signedIn: false }, claude: { installed: false, signedIn: false } });

async function waitFor(check, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await pause(100); }
  throw new Error('Electron smoke check timed out.');
}
const js = async code => {
  try { return await win.webContents.executeJavaScript(code); }
  catch (error) { throw new Error(`Renderer script failed: ${code}\n${error.message}`); }
};
async function ipc(method, ...args) {
  const result = await js(`window.desktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  assert.equal(result.ok, true, result.error); return result.value;
}
async function tab(name) { await js(`document.getElementById('tab-${name}').click()`); await pause(120); }
async function shot(name) { await fs.writeFile(path.join(root, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
async function project(name) {
  const folder = path.join(root, name); await fs.mkdir(folder, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: folder, windowsHide: true, stdio: 'pipe' });
  git(['init']); git(['config', 'user.name', 'Smoke']); git(['config', 'user.email', 'smoke@example.invalid']);
  await fs.writeFile(path.join(folder, 'file.txt'), 'original'); git(['add', '.']); git(['commit', '-m', 'Fixture']);
  await fs.writeFile(path.join(folder, 'file.txt'), name); return folder;
}

async function main() {
  await fs.mkdir(root, { recursive: true });
  const motion = path.join(root, 'motionkit');
  await fs.mkdir(path.join(motion, 'brands/lab/films'), { recursive: true });
  await fs.mkdir(path.join(motion, 'lib'), { recursive: true });
  await fs.writeFile(path.join(motion, 'package.json'), '{"name":"motionkit"}');
  await fs.writeFile(path.join(motion, 'brands/lab/films/demo.html'), '<!doctype html><h1>Standalone MotionKit preview fixture</h1>');
  const first = await project('first-project'), second = await project('second-project');
  require('../electron/main.cjs');
  await waitFor(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() && win.webContents.getURL().startsWith('file:'); });
  await waitFor(() => js('Boolean(window.desktop && document.getElementById("tab-faceless"))'));
  assert.equal(await js('document.querySelectorAll("[role=tab]").length'), 3);
  await shot('workspace-light');
  await tab('editing'); assert.equal(await js('document.querySelector(".studio-title-row h1").textContent'), 'motionkit.');
  dialogs.push(motion); await ipc('chooseStudio', 'editing'); await pause(120);
  assert.deepEqual((await ipc('getStudios')).editing.films.map(film => film.id), ['lab/demo']);
  await ipc('previewMotion', 'lab/demo');
  assert.match(await (await fetch(external.at(-1))).text(), /Standalone MotionKit/);
  await shot('editing-light');
  const state = await ipc('getState'); await ipc('appearance', { ...state.appearance, theme: 'dark' }); await pause(150); await shot('editing-dark');
  await tab('faceless');
  assert.equal(await js('document.querySelector(".generate-video").disabled'), true);
  await js(`{ const input = document.getElementById('video-topic'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'A quiet moment beside the ocean'); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  await pause(120); assert.equal(await js('document.getElementById("video-topic").value'), 'A quiet moment beside the ocean');
  await tab('workspace'); await tab('faceless');
  assert.equal(await js('document.getElementById("video-topic").value'), 'A quiet moment beside the ocean');
  await shot('faceless-dark');
  await ipc('appearance', { ...state.appearance, theme: 'light' }); await pause(120); await shot('faceless-light');
  win.setSize(980, 760); await pause(200); await shot('faceless-compact');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
  win.setSize(1440, 1000);
  await tab('workspace'); dialogs.push(first); await ipc('chooseProject'); await pause(200);
  await js(`Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.startsWith('changes')).click()`);
  await waitFor(() => js('Boolean(document.querySelector(".changed-files button"))'));
  await js('document.querySelector(".changed-files button").click()');
  await waitFor(() => js('document.querySelector(".diff-preview").textContent.includes("first-project")'));
  dialogs.push(second); await ipc('chooseProject'); await pause(200);
  assert.equal(await js('document.querySelector(".diff-preview").textContent.includes("first-project")'), false);
  await js(`document.querySelector('[aria-label="Close dialog"]').click()`);
  const bad = await js(`window.desktop.runFaceless({topic:'Test',genre:'reflection',scenes:0,notes:''})`);
  assert.equal(bad.ok, false);
  if (live) {
    await tab('faceless');
    const studios = await ipc('runFaceless', { topic: 'A quiet moment beside the ocean', genre: 'reflection', scenes: 2, notes: '' });
    assert.equal(studios.faceless.job.status, 'running');
    await waitFor(async () => (await ipc('getStudios')).faceless.job.status !== 'running', 240000);
    const result = (await ipc('getStudios')).faceless.job;
    assert.equal(result.status, 'done', result.logs.join('\n')); await pause(150);
    await ipc('openStudio', 'faceless', 'video'); await ipc('openStudio', 'faceless', 'output');
    assert.equal(opened.at(-2), result.video); await shot('faceless-complete');
    await fs.writeFile(path.join(root, 'live-job.json'), JSON.stringify(result, null, 2));
  }
  win.close(); await waitFor(() => win.isDestroyed());
  const saved = JSON.parse(await fs.readFile(path.join(root, 'profile/workspace.json'), 'utf8'));
  assert.equal(saved.studios.editing, motion); assert.ok(saved.chats.length >= 1);
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, liveFaceless: live, tabs: 3, profileIsolated: true, studioSettingsSaved: true, staleDiffCleared: true }, null, 2));
  console.log('Native Electron smoke passed. Screenshots and report: ' + root);
  finished = true; app.exit(0);
}
main().catch(async error => {
  await fs.writeFile(path.join(root, 'error.txt'), error.stack || String(error)).catch(() => {});
  console.error(error); if (win && !win.isDestroyed()) { win.close(); await waitFor(() => win.isDestroyed(), 5000).catch(() => {}); }
  finished = true; app.exit(1);
});
