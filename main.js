// kopbri.ai desktop app (Electron). Runs server.js in-process on a free 127.0.0.1 port and
// shows it in a window. Also keeps a short in-memory history of what the user copies, so the
// "+" menu can offer recent images, files and texts. Nothing of that is written to disk.
'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, clipboard, dialog, shell, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const executableDir = app.isPackaged ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath) : __dirname;
const dataRoot = app.isPackaged && process.platform==='darwin' ? app.getPath('userData') : app.isPackaged && path.basename(executableDir).toLowerCase() === 'dist' ? path.dirname(executableDir) : executableDir;
const profileDir = path.join(dataRoot, '.kopbri', 'desktop');
fs.mkdirSync(profileDir, { recursive: true });
app.setPath('userData', profileDir);

if (process.argv.includes('--setup-providers')) { require('./setup-window.cjs').start(app,process.argv.includes('--silent-setup')); return; }

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')); } catch { return {}; } }
function saveSettings(s) { try { fs.writeFileSync(SETTINGS(), JSON.stringify(s, null, 2)); } catch { /* read-only profile */ } }
function defaultCwd() { return dataRoot; }

const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_SIDE = 1568;
function fileToDataUrl(f) {
  const mime = IMG_EXT[path.extname(f).toLowerCase()];
  return mime ? `data:${mime};base64,${fs.readFileSync(f).toString('base64')}` : null;
}
function imageToDataUrl(img) {
  const { width, height } = img.getSize();
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  return (k < 1 ? img.resize({ width: Math.round(width * k), quality: 'good' }) : img).toDataURL();
}

// ---------- clipboard history ----------
const history = { images: [], files: [], texts: [] };   // newest first, max 8 each
let lastKey = '';
function clipFile() {
  // Explorer "Copy" puts the path list in FileNameW (first file only is enough here)
  const raw = clipboard.readBuffer('FileNameW');
  if (!raw || !raw.length) return null;
  const f = raw.toString('utf16le').replace(/\0.*$/s, '');
  return f && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
}
function push(list, item, same) {
  const i = list.findIndex(same); if (i >= 0) list.splice(i, 1);
  list.unshift(item); list.length = Math.min(list.length, 8);
}
function pollClipboard() {
  try {
    const file = clipFile();
    if (file) {
      if (lastKey === 'f:' + file) return; lastKey = 'f:' + file;
      return push(history.files, file, x => x === file);
    }
    const img = clipboard.readImage();
    if (!img.isEmpty()) {
      const key = 'i:' + crypto.createHash('sha1').update(img.resize({ width: 24, height: 24 }).toBitmap()).digest('hex') + JSON.stringify(img.getSize());
      if (key === lastKey) return; lastKey = key;
      const url = imageToDataUrl(img);
      return push(history.images, { key, url }, x => x.key === key);
    }
    const text = clipboard.readText();
    if (text && text.trim()) {
      const key = 't:' + crypto.createHash('sha1').update(text).digest('hex');
      if (key === lastKey) return; lastKey = key;
      push(history.texts, text.slice(0, 20000), x => x === text);
    }
  } catch { /* clipboard busy */ }
}

// ---------- bridge for preload.js ----------
ipcMain.handle('clip:now', () => {
  const file = clipFile();
  if (file) return IMG_EXT[path.extname(file).toLowerCase()] ? { image: fileToDataUrl(file) } : { file };
  const img = clipboard.readImage();
  if (!img.isEmpty()) return { image: imageToDataUrl(img) };
  return { text: clipboard.readText() || null };
});
ipcMain.handle('clip:history', () => ({ images: history.images.map(x => x.url), files: history.files, texts: history.texts }));
ipcMain.handle('clip:clear', () => { history.images = []; history.files = []; history.texts = []; lastKey = ''; });
// Quick exit: the page has already logged out and deleted sessions through the server;
// here we drop every trace in Electron's own profile (storage, cache) and quit.
ipcMain.handle('app:wipe-quit', async e => {
  history.images = []; history.files = []; history.texts = []; lastKey = '';
  const ses = e.sender.session;
  try { await ses.clearStorageData(); await ses.clearCache(); await ses.clearAuthCache(); } catch { /* best effort */ }
  setTimeout(() => app.quit(), 50);
});
ipcMain.handle('pick:files', async (e, language) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: language === 'en' ? 'Choose files' : 'Dosya seç', properties: ['openFile', 'multiSelections'],
    filters: [{ name: language === 'en' ? 'All files' : 'Tüm dosyalar', extensions: ['*'] }, { name: language === 'en' ? 'Images' : 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  return r.canceled ? [] : r.filePaths.map(f => { const u = fileToDataUrl(f); return u ? { dataUrl: u } : { path: f }; });
});
ipcMain.handle('pick:folder', async (e, language) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: language === 'en' ? 'Workspace folder' : 'Çalışma klasörü', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const s = loadSettings(); s.cwd = r.filePaths[0]; saveSettings(s);
  server.setCwd(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle('file:reveal', async (_event, relative) => {
  if (typeof relative !== 'string' || !server) return false;
  try { const root = fs.realpathSync(server.getCwd()), target = fs.realpathSync(path.resolve(root, relative)); const rel = path.relative(root, target);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false;
    shell.showItemInFolder(target); return true;
  } catch { return false; }
});
// ---------- window ----------
let win, server, tray, stopPushToTalk, spotlight, github;
let quitting = false;
function reveal(mode) {
  if (['search','voice','voice-hold','voice-release'].includes(mode)) { spotlight?.send(mode); return; }
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!mode) return;
  const send = () => win.webContents.send('kopbri:spotlight',mode);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load',send);
  else send();
}
let interfaceLanguage = 'tr';
const englishMenu = {
  'kopbri’yi aç':'Open kopbri','Hızlı arama':'Quick search','Sesli ajan görüşmesi':'Voice conversation','Çık':'Quit',
  'Yeni sohbet':'New chat','Sohbet geçmişi':'Chat history','GitHub projeleri':'GitHub projects','Ayarlar':'Settings',
  'Geri al':'Undo','Yinele':'Redo','Kes':'Cut','Kopyala':'Copy','Yapıştır':'Paste','Tümünü seç':'Select all',
  'Ajan Ofisi':'Agent Office','Görevler':'Tasks','Ajan konuşmaları':'Agent conversations',
  'Normal boyut':'Actual size','Yakınlaştır':'Zoom in','Uzaklaştır':'Zoom out',
  'Hızlı arama · Ctrl+Space':'Quick search · Ctrl+Space','Canlı görüşme · Ctrl+Shift+Space':'Live conversation · Ctrl+Shift+Space'
};
function localizedMenu(items) {
  return Menu.buildFromTemplate(items.map(item=>interfaceLanguage==='en' && englishMenu[item.label] ? {...item,label:englishMenu[item.label]} : item));
}
ipcMain.on('kopbri:interface-language',(event,language)=>{
  if (event.sender!==win?.webContents || (language!=='en' && language!=='tr')) return;
  interfaceLanguage=language;
  refreshTrayMenu();
});
function registerTray() {
  tray = new Tray(path.join(__dirname,'public','kopbri-mark.png'));
  tray.setToolTip('kopbri');
  tray.on('click',() => reveal());
  const shortcuts = [['Control+Space','search']];
  for (const [key,mode] of shortcuts) if (!globalShortcut.register(key,() => reveal(mode))) console.warn('kopbri kısayolu kaydedilemedi: '+key);
  stopPushToTalk = require('./push-to-talk.cjs')(globalShortcut,mode => {
    if (mode==='voice-hold') reveal(mode);
    else spotlight?.send(mode);
  });
  refreshTrayMenu();
}
function refreshTrayMenu() {
  tray?.setContextMenu(localizedMenu([
    {label:'kopbri’yi aç',click:() => reveal()},
    {label:'Hızlı arama',click:() => reveal('search')},
    {label:'Sesli ajan görüşmesi',click:() => reveal('voice')},
    {type:'separator'},{label:'Çık',click:() => app.quit()}
  ]));
}
async function createWindow() {
  process.env.KOPBRI_DATA_ROOT = dataRoot;
  server = require('./server.js');
  const port = await server.start({ port: 0, cwd: loadSettings().cwd || defaultCwd() });
  const origin = `http://127.0.0.1:${port}`;
  const workArea=screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440,Math.round(workArea.width*.88)), height: Math.min(900,Math.round(workArea.height*.87)), center: true, minWidth: Math.min(900,workArea.width), minHeight: Math.min(680,workArea.height),
    title: "kopbri", titleBarStyle: 'hidden', titleBarOverlay: {color:'#edf6f9',symbolColor:'#18343d',height:36}, backgroundColor: '#ffffff', autoHideMenuBar: true,
    icon: path.join(__dirname, 'public', 'kopbri-mark.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required', autoplayPolicy: 'no-user-gesture-required' },
  });
  // links (login pages) open in the real browser; the window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('close',event => { if (!quitting && tray) { event.preventDefault(); win.hide(); } });
  ipcMain.on('kopbri:window-menu',(event,key,x,y) => {
    if (event.sender!==win.webContents || !Number.isInteger(x) || !Number.isInteger(y)) return;
    const go = mode => () => reveal('open:'+mode);
    const menus = {
      file:[{label:'Yeni sohbet',click:go('new-chat')},{label:'Sohbet geçmişi',click:go('history')},{label:'GitHub projeleri',click:go('github')},{label:'Ayarlar',click:go('settings')},{type:'separator'},{label:'Çık',click:()=>app.quit()}],
      edit:[{role:'undo',label:'Geri al'},{role:'redo',label:'Yinele'},{type:'separator'},{role:'cut',label:'Kes'},{role:'copy',label:'Kopyala'},{role:'paste',label:'Yapıştır'},{role:'selectAll',label:'Tümünü seç'}],
      view:[{label:'Ajan Ofisi',click:go('office')},{label:'Görevler',click:go('tasks')},{label:'Ajan konuşmaları',click:go('chat')},{type:'separator'},{role:'resetZoom',label:'Normal boyut'},{role:'zoomIn',label:'Yakınlaştır'},{role:'zoomOut',label:'Uzaklaştır'}],
      help:[{label:'Hızlı arama · Ctrl+Space',click:()=>reveal('search')},{label:'Canlı görüşme · Ctrl+Shift+Space',click:()=>reveal('voice')},{type:'separator'},{label:'kopbri '+app.getVersion(),enabled:false}]
    };
    if (Object.hasOwn(menus,key)) localizedMenu(menus[key]).popup({window:win,x,y});
  });
  win.loadURL(origin + '/');
  spotlight = require('./desktop-spotlight.cjs')(origin,reveal,() => stopPushToTalk?.release());
  github = require('./github-workspaces.cjs')(dataRoot,async () => {
    const picked = await dialog.showOpenDialog(win,{title:'GitHub deposu için hedef klasör',properties:['openDirectory','createDirectory']});
    return picked.canceled ? null : picked.filePaths[0];
  },folder => {
    const settings = loadSettings(); settings.cwd=folder; saveSettings(settings); server.setCwd(folder);
  });
  const cloudflare = require('./cloudflare-connection.cjs')(dataRoot);
  ipcMain.on('kopbri:agent-voice',(event,index) => {
    if (event.sender===win.webContents && Number.isInteger(index) && index>=0 && index<200) spotlight.send('voice-agent:'+index);
  });
  const mail = require('./mail-connection.cjs')(dataRoot);
  ipcMain.handle('kopbri:mail',async (event,provider,action,payload) => {
    const frame=event.senderFrame;
    if (!frame || frame!==event.sender.mainFrame || ![origin+'/',origin+'/?spotlight=1'].includes(frame.url)) return null;
    if (action==='overview') return mail(null,'overview');
    if (action==='draft') {
      const draft={to:String(payload?.to || '').slice(0,254),subject:String(payload?.subject || '').slice(0,180),body:String(payload?.body || '').slice(0,12000)};
      reveal();
      win.webContents.send('kopbri:mail-draft',draft);
      return {drafted:true};
    }
    if (event.sender!==win.webContents) return null;
    if (action==='send') {
      const to=String(payload?.to || '').trim(), subject=String(payload?.subject || '').trim(), body=String(payload?.body || '');
      if (!/^[\w.!#$%&'*+\-/=?^\x60{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(to) || to.length>254 || !subject || subject.length>180 || /[\r\n]/.test(subject) || !body.trim() || body.length>12000) throw Error('Alıcı, konu ve mesajı kontrol et.');
      const en=interfaceLanguage==='en';
      const answer=await dialog.showMessageBox(win,{type:'question',title:en?'Confirm email':'E-postayı onayla',
        message:en?'Send this email?':'Bu e-posta gönderilsin mi?',detail:to+'\n'+subject+'\n\n'+body.slice(0,700),
        buttons:en?['Cancel','Send']:['Vazgeç','Gönder'],defaultId:0,cancelId:0,noLink:true});
      if(answer.response!==1)return {sent:false};
      return mail(provider,'send',{to,subject,body});
    }
    return mail(provider,action,payload);
  });
  ipcMain.handle('kopbri:cloudflare',(event,action,payload) => {
    if (event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame) return null;
    return cloudflare(action,payload);
  });
  ipcMain.handle('kopbri:onboarding',(event,action) => {
    if (event.sender!==win.webContents) return true;
    const settings=loadSettings();
    if (action==='done') { settings.onboardingDone=true; saveSettings(settings); }
    return Boolean(settings.onboardingDone);
  });
  ipcMain.handle('kopbri:github',(event,action,payload) => {
    if (event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame) return null;
    return github.action(action,payload);
  });
  const folderAccess = require('./folder-access.cjs');
  ipcMain.handle('kopbri:folder-access',(event,mode,engine,expected) => {
    const senderOrigin = event.senderFrame?.url;
    if (!senderOrigin || new URL(senderOrigin).origin!==origin) return null;
    const status = folderAccess.manage(server.getCwd(),'status',engine);
    if (mode==='status') return status;
    if (mode==='revoke') return folderAccess.manage(server.getCwd(),mode,engine);
    if (!status || status.folder!==expected || !['once','session'].includes(mode)) return null;
    return folderAccess.manage(server.getCwd(),mode,engine);
  });
}

app.whenReady().then(() => {
  createWindow().then(registerTray).catch(error => { console.error(error); app.quit(); });
  setInterval(pollClipboard, 1200);
});
app.on('second-instance', () => reveal());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); stopPushToTalk?.(); spotlight?.destroy(); github?.stop(); if (server) server.shutdown(); });
