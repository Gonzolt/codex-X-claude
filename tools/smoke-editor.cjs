// Edits only a generated MotionKit fixture. --live uses signed-in native agents.
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
const root = path.resolve(__dirname, '../.cache/editor-smoke-' + Date.now());
const motion = path.join(root, 'motionkit'), file = path.join(motion, 'brands/lab/films/demo.html');
const live = process.argv.includes('--live');
process.argv.push('--headless-test'); process.env.CXC_TEST_USER_DATA = path.join(root, 'profile');
let win, finished = false;
const calls = [];
app.on('before-quit', event => { if (!finished) event.preventDefault(); });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [motion] });
dialog.showMessageBoxSync = () => 1;
shell.openExternal = async () => {}; shell.openPath = async () => '';
const agents = require('../electron/agents.cjs');
if (!live) {
  for (const name of ['CodexAgent', 'ClaudeAgent']) agents[name] = class {
    constructor(_path, emit) { this.emit = emit; }
    async run(prompt, cwd, readOnly, options) {
      calls.push({ agent: name, cwd, readOnly }); assert.equal(cwd, motion);
      if (!readOnly) {
        const marker = prompt.match(/CHANGE_TO_(codex|claude|both)/)?.[0]; assert.ok(marker);
        await fs.writeFile(file, '<!doctype html><h1>' + marker + '</h1>');
        this.emit(name === 'CodexAgent' ? 'codex' : 'claude', 'Updated the generated film fixture.', 'message', String(calls.length));
      }
      return options?.review ? { review: { needsChanges: false, summary: 'Verified the fixture edit.', findings: [] } } : 'Updated demo.html.';
    }
    stop() {} close() {}
  };
  agents.detectAgents = async () => ({ codex: { installed: true, signedIn: true, path: 'fixture-codex' }, claude: { installed: true, signedIn: true, path: 'fixture-claude' } });
}
async function waitFor(check, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await pause(100); }
  throw new Error('Editing smoke timed out.');
}
const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { throw new Error(code + '\n' + error.message); } };
async function ipc(name, ...args) { const r = await js(`window.desktop[${JSON.stringify(name)}](...${JSON.stringify(args)})`); assert.equal(r.ok, true, r.error); return r.value; }
async function tab(name) { await js(`document.getElementById('tab-${name}').click()`); await pause(100); }
async function type(text) {
  await js(`{const el=document.getElementById('edit-prompt');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
}
async function screenshot(name) { await fs.writeFile(path.join(root, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
async function main() {
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.mkdir(path.join(motion, 'lib'), { recursive: true });
  await fs.writeFile(path.join(motion, 'package.json'), '{"name":"motionkit"}');
  await fs.writeFile(path.join(motion, 'README.md'), 'Generated test fixture. Edit only brands/lab/films/demo.html as requested. No install, network, generation, commit, push, upload or publishing.');
  await fs.writeFile(file, '<!doctype html><h1>ORIGINAL</h1>');
  require('../electron/main.cjs');
  await waitFor(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() && win.webContents.getURL().startsWith('file:'); });
  await waitFor(() => js('Boolean(window.desktop && document.getElementById("tab-editing"))'));
  await waitFor(async () => (await ipc('getState')).agents.claude.installed);
  const blocked = () => js('document.getElementById("edit-blocked")?.textContent || ""');
  const sendable = () => js('Boolean(document.querySelector(".editing-prompt-form [type=submit]:not(:disabled)"))');
  await tab('editing');
  if (await js('Boolean(document.getElementById("edit-prompt"))')) { assert.match(await blocked(), /Get MotionKit/); assert.equal(await sendable(), false); }
  await ipc('chooseStudio', 'editing'); await pause(150);
  await waitFor(() => js('Boolean(document.getElementById("edit-prompt"))'));
  await type(''); await pause(50);
  assert.match(await blocked(), /Describe the change/); assert.equal(await sendable(), false);
  await type('My unsent editing prompt'); await pause(50);
  assert.equal(await blocked(), ''); assert.equal(await sendable(), true);
  await tab('faceless'); await tab('editing');
  assert.equal(await js('document.getElementById("edit-prompt").value'), 'My unsent editing prompt');
  const initialCoding = await ipc('getState');
  for (const target of ['codex', 'claude', 'both']) {
    await waitFor(() => js('Boolean(document.querySelector(".editing-prompt-form [type=submit]"))'));
    await type(`Change the h1 in brands/lab/films/demo.html to exactly CHANGE_TO_${target}. Do not change any other file. No install, network, generation, git or upload operations. Verify by reading the file.`);
    await js(`Array.from(document.querySelectorAll('.editing-targets button')).find(b=>b.textContent.toLowerCase().includes(${JSON.stringify(target === 'codex' ? 'chatgpt' : target)})).click()`);
    await waitFor(() => js('Boolean(document.querySelector(".editing-prompt-form [type=submit]:not(:disabled)"))'));
    await js('document.querySelector(".editing-prompt-form [type=submit]").click()');
    let sawTask = false;
    await waitFor(async () => {
      const state = await ipc('getEditor');
      sawTask ||= state.events.some(event => event.agent === 'you' && event.text.includes('CHANGE_TO_' + target));
      for (const item of state.approvals) {
        let allow = false;
        try { const input = JSON.parse(item.detail); allow = ['Write', 'Edit'].includes(item.title) && path.resolve(input.file_path || '') === file; } catch {}
        await ipc('approveEdit', item.id, allow);
      }
      if (sawTask && !state.busy) {
        assert.ok(!Object.values(state.status).includes('error'), state.events.map(event => event.text).join('\n'));
        return true;
      }
      return false;
    }, live ? 180000 : 15000);
    assert.match(await fs.readFile(file, 'utf8'), new RegExp('CHANGE_TO_' + target));
    assert.equal((await ipc('getState')).events.length, initialCoding.events.length);
  }
  if (!live) assert.deepEqual(calls.map(call => call.agent), ['CodexAgent', 'ClaudeAgent', 'CodexAgent', 'ClaudeAgent']);
  await type('An editing draft to preserve');
  const old = (await ipc('getEditor')).activeChatId;
  await ipc('freshEdit'); await pause(100); await ipc('selectEditChat', old); await pause(150);
  assert.equal(await js('document.getElementById("edit-prompt").value'), 'An editing draft to preserve');
  await screenshot('editing-light');
  const coding = await ipc('getState'); await ipc('appearance', { ...coding.appearance, theme: 'dark' }); await pause(150); await screenshot('editing-dark');
  win.setSize(980, 760); await pause(150); await screenshot('editing-compact');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
  win.close(); await waitFor(() => win.isDestroyed());
  const saved = JSON.parse(await fs.readFile(path.join(root, 'profile/workspace.json'), 'utf8'));
  assert.equal(saved.editor.chats.find(chat => chat.id === old).draft, 'An editing draft to preserve');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, liveAgents: live, targets: ['codex', 'claude', 'both'], fileChanged: true, separateHistory: true, editDraftSaved: true }, null, 2));
  console.log('Editing prompt smoke passed: ' + root); finished = true; app.exit(0);
}
main().catch(async error => {
  console.error(error); await fs.writeFile(path.join(root, 'error.txt'), error.stack || String(error)).catch(() => {});
  if (win && !win.isDestroyed()) { win.close(); await waitFor(() => win.isDestroyed(), 5000).catch(() => {}); }
  finished = true; app.exit(1);
});
