'use strict';
const {BrowserWindow,ipcMain} = require('electron');
const path = require('node:path');
const tools = require('./provider-tools.cjs');
function start(app,silent=false) {
  app.whenReady().then(async () => {
    if (silent) {
      try { const result = await tools.install(()=>{}); app.exit(Object.values(result).includes('error')?1:0); }
      catch { app.exit(1); }
      return;
    }
    const selected = process.argv.find(arg=>arg.startsWith('--setup-language='))?.split('=')[1];
    const language = selected ? (selected==='1055'?'tr':'en') : (app.getLocale().startsWith('tr')?'tr':'en');
    const win = new BrowserWindow({
      width:590,height:520,center:true,resizable:false,show:false,backgroundColor:'#f5f8f6',title:language==='tr'?'kopbri · kurulum':'kopbri · setup',
      icon:path.join(__dirname,'public','kopbri-mark.png'),autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'setup-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}
    });
    let running = false;
    ipcMain.handle('kopbri:setup:start',async event => {
      if (event.sender!==win.webContents || running) return {};
      running = true;
      try { return await tools.install((...state)=>{if(!win.isDestroyed())win.webContents.send('kopbri:setup:state',...state);}); }
      finally { running = false; }
    });
    ipcMain.on('kopbri:setup:finish',event => { if(event.sender===win.webContents&&!running) app.quit(); });
    win.on('close',event=>{if(running)event.preventDefault();});
    win.once('ready-to-show',()=>win.show());
    win.on('closed',()=>app.quit());
    win.loadFile(path.join(__dirname,'public','setup.html'),{query:{language}});
  });
}
module.exports = {start};
