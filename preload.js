// Narrow bridge between the page and the Electron main process (window.bb).
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bb', {
  openAgentVoice: index => ipcRenderer.send('kopbri:agent-voice',index),
  mail: (provider,action,payload) => ipcRenderer.invoke('kopbri:mail',provider,action,payload),
  onMailDraft: listener => ipcRenderer.on('kopbri:mail-draft',(_event,draft)=>listener(draft)),
  cloudflare: (action,payload) => ipcRenderer.invoke('kopbri:cloudflare',action,payload),
  onboarding: action => ipcRenderer.invoke('kopbri:onboarding',action),
  githubAction: (action,payload) => ipcRenderer.invoke('kopbri:github',action,payload),
  interfaceLanguage: language => ipcRenderer.send('kopbri:interface-language',language),
  windowMenu: (key,x,y) => ipcRenderer.send('kopbri:window-menu',key,x,y),
  spotlightAction: (action,mode) => ipcRenderer.send('kopbri:spotlight-action',action,mode),
  folderAccess: (mode,engine,expected) => ipcRenderer.invoke('kopbri:folder-access',mode,engine,expected),
  onSpotlight: callback => {
    if (typeof callback === 'function') ipcRenderer.on('kopbri:spotlight',(_event,mode) => callback(mode));
  },
  clipboardNow: () => ipcRenderer.invoke('clip:now'),
  clipboardHistory: () => ipcRenderer.invoke('clip:history'),
  clearHistory: () => ipcRenderer.invoke('clip:clear'),
  revealFile: relative => ipcRenderer.invoke('file:reveal', relative),
  pickFiles: language => ipcRenderer.invoke('pick:files', language),
  pickFolder: language => ipcRenderer.invoke('pick:folder', language),
  wipeAndQuit: () => ipcRenderer.invoke('app:wipe-quit'),
  pathFor: file => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
});
