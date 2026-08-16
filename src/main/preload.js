'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  resolveCommands: (s) => ipcRenderer.invoke('settings:resolve', s),

  start: () => ipcRenderer.invoke('docker:start'),
  stop: () => ipcRenderer.invoke('docker:stop'),
  status: () => ipcRenderer.invoke('docker:status'),
  listDir: (dirPath) => ipcRenderer.invoke('docker:list-dir', dirPath),
  exportFiles: (payload) => ipcRenderer.invoke('docker:export', payload),

  chooseDir: () => ipcRenderer.invoke('app:choose-dir'),
  openFolder: (p) => ipcRenderer.invoke('app:open-folder', p),
  gpuStatus: () => ipcRenderer.invoke('app:gpu-status'),
  openExternal: () => ipcRenderer.invoke('app:open-external'),

  layout: (state) => ipcRenderer.invoke('ui:layout', state),
  guestLoad: (url) => ipcRenderer.invoke('guest:load', url),
  guestReload: () => ipcRenderer.invoke('guest:reload'),
  guestBack: () => ipcRenderer.invoke('guest:back'),
  guestForward: () => ipcRenderer.invoke('guest:forward'),
  guestGetUrl: () => ipcRenderer.invoke('guest:get-url'),
  guestExec: (code) => ipcRenderer.invoke('guest:exec', code),

  onGuestUrl: (cb) => {
    const h = (_e, url) => cb(url);
    ipcRenderer.on('guest:url', h);
    return () => ipcRenderer.removeListener('guest:url', h);
  },
  onGuestDomReady: (cb) => {
    const h = () => cb();
    ipcRenderer.on('guest:dom-ready', h);
    return () => ipcRenderer.removeListener('guest:dom-ready', h);
  },
  onGuestFail: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('guest:fail', h);
    return () => ipcRenderer.removeListener('guest:fail', h);
  },

  onLog: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  }
});
