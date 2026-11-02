// What the Settings window may ask of the app, and nothing more: it has no Node of its own.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('carrelApp', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (changes) => ipcRenderer.invoke('settings:set', changes),
  login: (on) => ipcRenderer.invoke('settings:login', on),
  choose: (folders) => ipcRenderer.invoke('settings:choose', folders),
  apply: () => ipcRenderer.invoke('settings:apply'),
  showLog: () => ipcRenderer.invoke('settings:log'),
  onChange: (listener) => ipcRenderer.on('settings:changed', (_, state) => listener(state)),
});
