const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Coordinator } = require('./coordinator.cjs');
const { changes, fileDiff } = require('./workspace.cjs');

let win, coordinator, store, saveTimer, publishTimer, closing = false;
let saveQueue = Promise.resolve();
const dev = process.argv.includes('--dev');
const headlessTest = process.argv.includes('--headless-test');
if (headlessTest && process.env.CXC_TEST_USER_DATA) app.setPath('userData', process.env.CXC_TEST_USER_DATA);
const links = {
  repository: 'https://github.com/Gonzolt/codex-X-claude',
  codex: 'https://developers.openai.com/codex/cli',
  claude: 'https://code.claude.com/docs/en/setup'
};

function save() {
  if (!coordinator || !store) return Promise.resolve();
  const { project, events, appearance } = coordinator.state;
  const value = JSON.stringify({ project, events: events.filter(e => e.kind !== 'output').map(e => ({ ...e, streaming: false })), appearance });
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    try {
      await fs.writeFile(store + '.tmp', value);
      await fs.rename(store + '.tmp', store);
    } catch (error) { console.error('Could not save workspace:', error.message); }
  });
  return saveQueue;
}

function registerHandlers() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender.');
    try { return { ok: true, value: await fn(...args) }; }
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
  handle('agents:refresh', () => coordinator.refresh());
  handle('agents:start', task => coordinator.start(task));
  handle('agents:stop', agent => coordinator.stop(agent));
  handle('agents:approve', (id, allow) => {
    if (typeof id !== 'string' || typeof allow !== 'boolean') throw new Error('Invalid approval.');
    coordinator.answer(id, allow);
  });
  handle('workspace:changes', () => changes(coordinator.state.project));
  handle('workspace:diff', name => fileDiff(coordinator.state.project, name));
  handle('workspace:appearance', value => {
    if (!value || !['mint', 'lavender', 'peach'].includes(value.accent) || !['light', 'dark'].includes(value.theme) || typeof value.pattern !== 'boolean' || ![13, 14, 15, 16].includes(value.fontSize)) throw new Error('Invalid appearance settings.');
    coordinator.state.appearance = { accent: value.accent, theme: value.theme, pattern: value.pattern, fontSize: value.fontSize };
    coordinator.publish();
  });
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
  store = path.join(app.getPath('userData'), 'workspace.json');
  let initial = {};
  try { initial = JSON.parse(await fs.readFile(store, 'utf8')); } catch {}
  if (initial.project) try { if (!(await fs.stat(initial.project)).isDirectory()) initial.project = null; } catch { initial.project = null; }
  coordinator = new Coordinator(initial);
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
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
  });
  registerHandlers();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (closing) return;
    if (coordinator.state.busy) {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep working', 'Stop and close'], defaultId: 0, cancelId: 0, message: 'An agent is still working.', detail: 'Closing this window stops the current task.' });
      if (choice === 0) { event.preventDefault(); return; }
    }
    event.preventDefault(); closing = true;
    coordinator.close(); clearTimeout(saveTimer); clearTimeout(publishTimer);
    save().finally(() => { if (!win.isDestroyed()) win.destroy(); });
  });
  if (dev) await win.loadURL('http://127.0.0.1:5173'); else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  coordinator.refresh().catch(error => coordinator.event('system', error.message, 'error'));
});

app.on('window-all-closed', () => app.quit());
