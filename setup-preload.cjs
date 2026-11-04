'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('kopbriSetup',{
  start:()=>ipcRenderer.invoke('kopbri:setup:start'),
  finish:()=>ipcRenderer.send('kopbri:setup:finish'),
  onState:callback=>ipcRenderer.on('kopbri:setup:state',(_event,...args)=>callback(...args))
});
