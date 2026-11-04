'use strict';
const {BrowserWindow,ipcMain,screen} = require('electron');
const path = require('node:path');

function createSpotlight(origin,openMain,release) {
  const win = new BrowserWindow({
    show:false,width:580,height:530,frame:false,transparent:true,alwaysOnTop:true,
    resizable:false,skipTaskbar:true,hasShadow:false,backgroundColor:'#00000000',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,
      sandbox:true,autoplayPolicy:'no-user-gesture-required'}
  });
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate',event => event.preventDefault());
  win.on('close',event => {
    event.preventDefault();
    win.webContents.send('kopbri:spotlight','dismiss');
    win.hide();
  });
  function position(voice) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(voice?780:580,area.width-20);
    const height = Math.min(voice?735:530,area.height-25);
    win.setBounds({x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)*(voice ? .5 : .24)),width,height});
  }
  const action = (event,name,mode) => {
    if (event.sender!==win.webContents) return;
    if (name==='release') release();
    if (name==='voice-size') position(true);
    if (name==='hide') win.hide();
    if (name==='open' && typeof mode==='string' && /^(?:(?:office|tasks|chat|history)(?::\d{1,5})?|notes|tokens|new-chat|github|settings|cloudflare)$/.test(mode)) {
      win.hide(); openMain('open:'+mode);
    }
  };
  ipcMain.on('kopbri:spotlight-action',action);
  win.loadURL(origin+'/?spotlight=1');
  let held = false;
  function send(mode) {
    if (win.isDestroyed()) return;
    if (mode==='voice-hold') held = true;
    if (mode==='voice-release') {
      held = false;
      if (win.isVisible() && !win.webContents.isLoading()) win.webContents.send('kopbri:spotlight',mode);
      return;
    }
    position(mode==='voice' || mode==='voice-hold' || mode.startsWith('voice-agent:'));
    win.show();
    win.focus();
    const notify = () => {
      if (!win.isDestroyed() && win.isVisible()) win.webContents.send('kopbri:spotlight',mode==='voice-hold' && !held ? 'voice' : mode);
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load',notify);
    else notify();
  }
  return {send,destroy() { ipcMain.removeListener('kopbri:spotlight-action',action); if (!win.isDestroyed()) win.destroy(); }};
}
module.exports = createSpotlight;
