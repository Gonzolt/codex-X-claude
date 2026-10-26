const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Coordinator } = require('./coordinator.cjs');
const { changes, fileDiff } = require('./workspace.cjs');
const { Studios } = require('./studios.cjs');
const { WorkspaceStore } = require('./persistence.cjs');

let win, coordinator, studios, store, persistence, saveTimer, publishTimer, closing = false;
const dev = process.argv.includes('--dev');
const headlessTest = process.argv.includes('--headless-test');
if (headlessTest && process.env.CXC_TEST_USER_DATA) app.setPath('userData', process.env.CXC_TEST_USER_DATA);
const primaryInstance = headlessTest || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const links = {
  repository: 'https://github.com/Gonzolt/codex-X-claude',
  codex: 'https://developers.openai.com/codex/cli',
  claude: 'https://code.claude.com/docs/en/setup',
  motionkit: 'https://github.com/Gonzolt/motionkit'
};

function save() {
  if (!coordinator || !persistence) return Promise.resolve();
  return persistence.save({ ...coordinator.serialize(), studios: studios?.serialize() });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  if (!closing) saveTimer = setTimeout(() => save().catch(error => console.error('Could not autosave workspace:', error.message)), 700);
}

async function captureDraft() {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  let timer;
  const pending = win.webContents.executeJavaScript('(() => { const input = document.getElementById("task-prompt"); return input ? { id: input.dataset.chatId, value: input.value } : null; })()').catch(() => undefined);
  const value = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]);
  clearTimeout(timer);
  if (typeof value?.value === 'string' && coordinator.chats.some(chat => chat.id === value.id)) coordinator.setDraft(value.id, value.value);
}

app.on('second-instance', async () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore(); win.show(); win.focus();
  if (closing) return;
  if (coordinator.state.busy) { coordinator.event('system', 'Finish or stop the current task before opening a new chat.', 'notice'); return; }
  try { await captureDraft(); coordinator.fresh(); }
  catch (error) { console.error('Could not start a fresh chat:', error.message); }
});

function registerHandlers() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender.');
    try {
      if (closing && !['workspace:state', 'studios:state', 'workspace:draft', 'app:window'].includes(channel)) throw new Error('The workspace is saving and closing.');
      return { ok: true, value: await fn(...args) };
    }
    catch (error) { return { ok: false, error: error.message }; }
  });
  handle('workspace:state', () => coordinator.state);
  handle('workspace:choose', async () => {
    if (coordinator.state.busy) throw new Error('Stop the current task before switching projects.');
    const result = await dialog.showOpenDialog(win, { title: 'Open your project', properties: ['openDirectory'] });
    if (!result.canceled) {
      const folder = await fs.realpath(result.filePaths[0]);
      coordinator.setProject(folder);
    }
    return coordinator.state.project;
  });
  handle('workspace:fresh', () => coordinator.fresh());
  handle('workspace:chat', id => coordinator.selectChat(id));
  handle('workspace:draft', (id, value) => coordinator.setDraft(id, value));
  handle('agents:approvalMode', mode => coordinator.setApprovalMode(mode));
  handle('agents:refresh', () => coordinator.refresh());
  handle('agents:start', task => coordinator.start(task));
  handle('agents:stop', agent => coordinator.stop(agent));
  handle('agents:approve', (id, allow, content) => {
    if (typeof id !== 'string' || typeof allow !== 'boolean') throw new Error('Invalid approval.');
    coordinator.answer(id, allow, content);
  });
  handle('agents:inputUrl', id => {
    const item = coordinator.state.approvals.find(item => item.id === id && item.kind === 'url');
    if (!item?.url || new URL(item.url).protocol !== 'https:') throw new Error('This request has no supported HTTPS link.');
    return shell.openExternal(item.url);
  });
  handle('workspace:changes', () => changes(coordinator.state.project));
  handle('workspace:diff', name => fileDiff(coordinator.state.project, name));
  handle('workspace:appearance', value => {
    if (!value || !['mint', 'lavender', 'peach'].includes(value.accent) || !['light', 'dark'].includes(value.theme) || typeof value.pattern !== 'boolean' || ![13, 14, 15, 16].includes(value.fontSize)) throw new Error('Invalid appearance settings.');
    coordinator.state.appearance = { accent: value.accent, theme: value.theme, pattern: value.pattern, fontSize: value.fontSize };
    coordinator.publish();
  });
  handle('studios:state', () => studios.state);
  handle('studios:choose', async kind => {
    if (!['editing', 'faceless'].includes(kind)) throw new Error('Unknown studio.');
    const result = await dialog.showOpenDialog(win, { title: kind === 'editing' ? 'Select your standalone MotionKit folder' : 'Select your faceless workflow folder', properties: ['openDirectory'] });
    if (!result.canceled) await studios.configure(kind, result.filePaths[0]);
    return studios.state;
  });
  handle('studios:preview', async id => { await shell.openExternal(await studios.previewFilm(id)); });
  handle('studios:open', async (kind, target) => {
    const error = await shell.openPath(await studios.openPath(kind, target));
    if (error) throw new Error(error);
  });
  handle('studios:run', input => studios.runFaceless(input));
  handle('studios:stop', () => studios.stopFaceless());
  handle('agents:signin', async agent => {
    if (!['codex', 'claude'].includes(agent)) throw new Error('Unknown agent.');
    if (coordinator.state.busy) throw new Error('Finish the current task before signing in.');
    const executable = coordinator.state.agents[agent]?.path;
    if (!executable) throw new Error('Install the agent first, then refresh connections.');
    // No credentials ever enter the renderer. The native CLI owns sign-in.
    if (process.platform === 'win32') {
      const escaped = executable.replace(/'/g, "''");
      const command = `& '${escaped}' ${agent === 'codex' ? 'login' : 'auth login'}`;
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', command], { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', error => coordinator.event('system', error.message, 'error'));
      child.unref();
      return 'A sign-in terminal has opened. Finish signing in, then refresh connections.';
    }
    throw new Error(`Run ${agent === 'codex' ? 'codex login' : 'claude auth login'} in your terminal, then refresh connections.`);
  });
  handle('app:link', name => {
    if (!Object.hasOwn(links, name)) throw new Error('Unknown link.');
    return shell.openExternal(links[name]);
  });
  handle('app:window', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else throw new Error('Unknown window action.');
  });
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  store = path.join(app.getPath('userData'), 'workspace.json');
  persistence = new WorkspaceStore(store);
  let initial = {};
  try { initial = JSON.parse(await fs.readFile(store, 'utf8')); } catch {}
  if (initial.project) try { if (!(await fs.stat(initial.project)).isDirectory()) initial.project = null; } catch { initial.project = null; }
  coordinator = Coordinator.launch(initial);
  studios = new Studios({ ...initial.studios, faceless: initial.studios?.faceless || process.env.CXC_FACELESS_ROOT || path.resolve(__dirname, '../..') });
  await studios.initialize();
  let initialSaveError;
  await save().catch(error => { initialSaveError = error; });
  win = new BrowserWindow({
    width: 1440, height: 1000, minWidth: 940, minHeight: 740,
    title: 'Codex x Claude', icon: path.join(__dirname, '../build/icon.png'), frame: false, backgroundColor: '#eef4f4', show: !headlessTest,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: headlessTest }
  });
  coordinator.on('state', () => {
    if (!publishTimer) publishTimer = setTimeout(() => {
      publishTimer = null;
      if (!win.isDestroyed()) win.webContents.send('workspace:update', coordinator.state);
    }, 35);
    scheduleSave();
  });
  studios.on('state', () => {
    if (!win.isDestroyed()) win.webContents.send('studios:update', studios.state);
    scheduleSave();
  });
  registerHandlers();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (closing) { event.preventDefault(); return; }
    if (coordinator.state.busy || studios.child || studios.starting) {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep working', 'Stop and close'], defaultId: 0, cancelId: 0, message: 'Work is still running.', detail: 'Closing stops the current agents and video generation.' });
      if (choice === 0) { event.preventDefault(); return; }
    }
    event.preventDefault(); closing = true; win.setEnabled(false);
    (async () => {
      try {
        await captureDraft(); coordinator.close();
        clearTimeout(saveTimer); clearTimeout(publishTimer);
        await studios.stopFaceless();
        await save();
        await studios.close();
        if (!win.isDestroyed()) win.destroy();
      } catch (error) {
        closing = false; win.setEnabled(true); scheduleSave();
        const choice = dialog.showMessageBoxSync(win, { type: 'error', buttons: ['Retry save and close', 'Keep app open'], defaultId: 0, cancelId: 1, message: 'Your chat could not be saved. The app is staying open.', detail: error.message });
        if (choice === 0) win.close();
      }
    })();
  });
  if (dev) await win.loadURL('http://127.0.0.1:5173'); else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  if (initialSaveError) coordinator.event('system', `Autosave is unavailable: ${initialSaveError.message}. The app will stay open if saving fails when you close.`, 'error');
  coordinator.refresh().catch(error => coordinator.event('system', error.message, 'error'));
});

app.on('window-all-closed', () => app.quit());
