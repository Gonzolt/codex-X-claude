// Real launch/close/relaunch checks in an isolated profile, with no coding-agent turns.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');

if (!process.versions.electron) {
  (async () => {
    const { spawn } = require('node:child_process');
    const root = path.resolve(__dirname, '../.cache/chat-lifecycle-' + Date.now());
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({ activeChatId: 'previous-chat', chats: [{ id: 'previous-chat', title: 'Previous subject', project: null, updatedAt: 1, draft: 'Previous unsent draft', sessions: {}, events: [{ id: 'old', agent: 'you', text: 'Previous subject', kind: 'prompt', time: 1 }] }] }));
    for (const phase of ['first', 'reopen']) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [__filename, '--headless-test', '--phase=' + phase], { windowsHide: true, stdio: 'inherit', env: { ...process.env, CXC_TEST_USER_DATA: root } });
        child.once('error', reject); child.once('exit', resolve);
      });
      assert.equal(code, 0, phase + ' launch failed');
    }
    console.log('Chat launch/close/relaunch checks passed: ' + root);
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, dialog } = require('electron');
  const root = process.env.CXC_TEST_USER_DATA;
  const phase = process.argv.find(arg => arg.startsWith('--phase=')).split('=')[1];
  let finished = false, win, failSave = false, holdSave = false, releaseSave, saveWaiting = false, failureDialogs = 0;
  app.on('before-quit', event => { if (!finished) event.preventDefault(); });
  dialog.showMessageBoxSync = (_win, options) => { if (options.type === 'error') { failureDialogs++; return 1; } return 1; };
  const { WorkspaceStore } = require('../electron/persistence.cjs');
  const write = WorkspaceStore.prototype.save;
  WorkspaceStore.prototype.save = async function(value) {
    if (failSave) throw new Error('Simulated disk failure for close verification.');
    if (holdSave) { saveWaiting = true; await new Promise(resolve => { releaseSave = resolve; }); }
    return write.call(this, value);
  };
  require('../electron/agents.cjs').detectAgents = async () => ({ codex: { installed: false, signedIn: false }, claude: { installed: false, signedIn: false } });
  async function until(check) {
    for (let i = 0; i < 150; i++) { if (await check()) return; await pause(50); }
    throw new Error('Lifecycle check timed out in ' + phase);
  }
  const js = code => win.webContents.executeJavaScript(code);
  async function ipc(method, ...args) { const result = await js(`window.desktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`); assert.equal(result.ok, true, result.error); return result.value; }
  async function type(value) {
    await js(`{ const input=document.getElementById('task-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); }`);
  }
  (async () => {
    require('../electron/main.cjs');
    await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() && win.webContents.getURL().startsWith('file:'); });
    await until(() => js('Boolean(window.desktop && document.getElementById("task-prompt"))'));
    const launched = await ipc('getState');
    assert.notEqual(launched.activeChatId, 'previous-chat');
    assert.equal(launched.events.length, 0); assert.equal(launched.draft, '');
    assert.ok(launched.chats.some(chat => chat.id === 'previous-chat'));
    await ipc('selectChat', 'previous-chat');
    const expected = phase === 'first' ? 'Previous unsent draft' : 'Saved right before closing — last keystroke';
    await until(() => js('document.getElementById("task-prompt").value').then(value => value === expected));
    if (phase === 'first') {
      await type('Draft before opening the program again');
      app.emit('second-instance');
      await until(async () => (await ipc('getState')).activeChatId !== 'previous-chat');
      await until(() => js('document.getElementById("task-prompt").value === ""'));
      await ipc('selectChat', 'previous-chat');
      await until(() => js('document.getElementById("task-prompt").value === "Draft before opening the program again"'));
      await type('Saved right before closing — last keystroke');
      failSave = true; win.close();
      await until(() => failureDialogs === 1); assert.equal(win.isDestroyed(), false);
      failSave = false; holdSave = true; win.close();
      await until(() => saveWaiting); win.close(); assert.equal(win.isDestroyed(), false);
      holdSave = false; releaseSave();
    } else win.close();
    await until(() => win.isDestroyed());
    const saved = JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'));
    assert.equal(saved.chats.find(chat => chat.id === 'previous-chat').draft, 'Saved right before closing — last keystroke');
    assert.equal(saved.chats.find(chat => chat.id === 'previous-chat').events[0].text, 'Previous subject');
    await fs.writeFile(path.join(root, phase + '-report.json'), JSON.stringify({ passed: true, freshChatOnLaunch: true, oldChatPreserved: true, draftSavedOnClose: true, saveFailureKeptWindowOpen: phase === 'first', repeatedCloseWaitedForSave: phase === 'first' }, null, 2));
    console.log('Native chat lifecycle ' + phase + ' phase passed.'); finished = true; app.exit(0);
  })().catch(async error => { console.error(error); await fs.writeFile(path.join(root, phase + '-error.txt'), error.stack || String(error)).catch(() => {}); finished = true; app.exit(1); });
}
