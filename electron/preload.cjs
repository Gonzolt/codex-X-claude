const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getState: () => ipcRenderer.invoke('workspace:state'),
  chooseProject: () => ipcRenderer.invoke('workspace:choose'),
  refresh: () => ipcRenderer.invoke('agents:refresh'),
  start: task => ipcRenderer.invoke('agents:start', task),
  stop: agent => ipcRenderer.invoke('agents:stop', agent),
  approve: (id, allow, content) => ipcRenderer.invoke('agents:approve', id, allow, content),
  approvalMode: mode => ipcRenderer.invoke('agents:approvalMode', mode),
  openInputUrl: id => ipcRenderer.invoke('agents:inputUrl', id),
  selectChat: id => ipcRenderer.invoke('workspace:chat', id),
  setDraft: (id, value) => ipcRenderer.invoke('workspace:draft', id, value),
  signIn: agent => ipcRenderer.invoke('agents:signin', agent),
  fresh: () => ipcRenderer.invoke('workspace:fresh'),
  changes: () => ipcRenderer.invoke('workspace:changes'),
  diff: name => ipcRenderer.invoke('workspace:diff', name),
  appearance: value => ipcRenderer.invoke('workspace:appearance', value),
  openLink: name => ipcRenderer.invoke('app:link', name),
  getStudios: () => ipcRenderer.invoke('studios:state'),
  getEditor: () => ipcRenderer.invoke('editing:state'),
  startEdit: input => ipcRenderer.invoke('editing:start', input),
  stopEdit: agent => ipcRenderer.invoke('editing:stop', agent),
  freshEdit: () => ipcRenderer.invoke('editing:fresh'),
  selectEditChat: id => ipcRenderer.invoke('editing:chat', id),
  setEditDraft: (id, value) => ipcRenderer.invoke('editing:draft', id, value),
  editApprovalMode: mode => ipcRenderer.invoke('editing:approvalMode', mode),
  approveEdit: (id, allow, content) => ipcRenderer.invoke('editing:approve', id, allow, content),
  editInputUrl: id => ipcRenderer.invoke('editing:inputUrl', id),
  refreshFilms: () => ipcRenderer.invoke('studios:films'),
  subscribeEditor: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('editing:update', listener);
    return () => ipcRenderer.removeListener('editing:update', listener);
  },
  chooseStudio: kind => ipcRenderer.invoke('studios:choose', kind),
  installMotionKit: () => ipcRenderer.invoke('studios:install'),
  exportFolder: action => ipcRenderer.invoke('studios:exports', action),
  previewMotion: id => ipcRenderer.invoke('studios:preview', id),
  openStudio: (kind, target) => ipcRenderer.invoke('studios:open', kind, target),
  runFaceless: input => ipcRenderer.invoke('studios:run', input),
  stopFaceless: () => ipcRenderer.invoke('studios:stop'),
  subscribeStudios: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('studios:update', listener);
    return () => ipcRenderer.removeListener('studios:update', listener);
  },
  window: action => ipcRenderer.invoke('app:window', action),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('workspace:update', listener);
    return () => ipcRenderer.removeListener('workspace:update', listener);
  }
});
