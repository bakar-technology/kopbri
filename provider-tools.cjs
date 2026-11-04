'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const root = path.join(process.env.LOCALAPPDATA || os.homedir(),'kopbri','tools');
const roaming = path.join(process.env.APPDATA || os.homedir(),'npm','node_modules');
const dependencies = {codex:'@openai/codex',claude:'@anthropic-ai/claude-code',gemini:'@google/gemini-cli'};
const modules = [path.join(root,'node_modules'),roaming];
function bin(packageRoot,name) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
    const entry = typeof manifest.bin==='string' ? manifest.bin : manifest.bin?.[name];
    const full = path.join(packageRoot,entry);
    if (fs.existsSync(full)) return full;
  } catch {}
  return null;
}
function find(name) {
  const env = {codex:'CODEX_BIN',claude:'CLAUDE_BIN',gemini:'GEMINI_JS'}[name];
  if (process.env[env] && fs.existsSync(process.env[env])) return process.env[env];
  const directories=(process.env.PATH || '').split(path.delimiter);
  if(process.platform==='darwin')directories.push('/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local','bin'));
  for (const directory of directories) {
    const executable=path.join(directory,name+(process.platform==='win32'?'.exe':''));
    if (directory && name!=='gemini' && fs.existsSync(executable)) return executable;
  }
  if(process.platform==='darwin'&&name==='gemini'){
    for(const directory of ['/opt/homebrew/lib/node_modules','/usr/local/lib/node_modules',path.join(os.homedir(),'.npm-global','lib','node_modules')]){
      const installed=bin(path.join(directory,dependencies[name]),name);
      if(installed)return installed;
    }
  }
  if (name==='claude') {
    const userBin = path.join(os.homedir(),'.local','bin','claude.exe');
    if (fs.existsSync(userBin)) return userBin;
  }
  for (const directory of modules) {
    const manifest = path.join(directory,dependencies[name]);
    const installed = bin(manifest,name);
    if (installed) return installed;
  }
  return null;
}
function nodeRuntime() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath,'node-runtime'),
    path.join(__dirname,'.kopbri','node-runtime')
  ].filter(Boolean);
  for (const directory of candidates) {
    const node = path.join(directory,'node.exe'), npm = path.join(directory,'node_modules','npm','bin','npm-cli.js');
    if (fs.existsSync(node) && fs.existsSync(npm)) return {node,npm,directory};
  }
  return null;
}
function execute(entry,args,opts={},sync=false) {
  const js = /\.(?:[cm]?js)$/i.test(entry);
  const runtime = nodeRuntime();
  const executable = js ? runtime?.node || process.execPath : entry;
  const env = {...process.env,...opts.env};
  if (runtime) {
    env.PATH = runtime.directory+path.delimiter+(env.PATH || '');
    delete env.ELECTRON_RUN_AS_NODE;
  } else if (js && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return (sync?require('node:child_process').spawnSync:spawn)(executable,js?[entry,...args]:args,{...opts,env});
}
async function install(update) {
  const runtime = nodeRuntime();
  if (!runtime) throw Error('Kurulumun Node çalışma ortamı bulunamadı.');
  fs.mkdirSync(root,{recursive:true});
  const states = {};
  for (const [name,dependency] of Object.entries(dependencies)) {
    if (find(name)) { states[name]='ready'; update(name,'ready'); continue; }
    update(name,'installing');
    try {
      await new Promise((resolve,reject) => {
        const env = {...process.env,PATH:runtime.directory+path.delimiter+(process.env.PATH || '')};
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(runtime.node,[runtime.npm,'install','--prefix',root,'--omit=dev','--no-audit','--no-fund','--loglevel','error',
          '--registry=https://registry.npmjs.org',dependency],{cwd:root,env,windowsHide:true,stdio:['ignore','ignore','pipe']});
        let error = '';
        child.stderr.on('data',chunk => { error=(error+chunk).slice(-500); });
        const timer = setTimeout(()=>child.kill(),240000);
        child.on('error',failure=>{clearTimeout(timer);reject(failure);});
        child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(error || 'İndirme tamamlanamadı.'));});
      });
      if (!find(name)) throw Error('Kurulumdan sonra araç bulunamadı.');
      states[name]='ready'; update(name,'ready');
    } catch (error) { states[name]='error'; update(name,'error',error.message); }
  }
  return states;
}
module.exports = {root,find,execute,nodeRuntime,install};
