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
  signIn: agent => ipcRenderer.invoke('agents:signin', agent),
  fresh: () => ipcRenderer.invoke('workspace:fresh'),
  changes: () => ipcRenderer.invoke('workspace:changes'),
  diff: name => ipcRenderer.invoke('workspace:diff', name),
  appearance: value => ipcRenderer.invoke('workspace:appearance', value),
  openLink: name => ipcRenderer.invoke('app:link', name),
  window: action => ipcRenderer.invoke('app:window', action),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('workspace:update', listener);
    return () => ipcRenderer.removeListener('workspace:update', listener);
  }
});
