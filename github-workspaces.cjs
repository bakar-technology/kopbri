'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn,execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);

function createGithub(dataRoot,chooseFolder,openWorkspace) {
  const local = __dirname.includes('app.asar') && process.resourcesPath
    ? path.join(process.resourcesPath,'github','gh.exe') : path.join(__dirname,'.kopbri','github-runtime','gh.exe');
  const config = path.join(dataRoot,'.kopbri','github-auth');
  fs.mkdirSync(config,{recursive:true});
  const env = {...process.env,GH_CONFIG_DIR:config,GH_HOST:'github.com',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1',NO_COLOR:'1'};
  for (const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN','GH_PROMPT_DISABLED']) delete env[key];
  const executable = fs.existsSync(local)?local:process.platform==='win32'?'gh.exe':(['/opt/homebrew/bin/gh','/usr/local/bin/gh'].find(file=>fs.existsSync(file)) || 'gh');
  const gh = (args,opts={}) => run(executable,args,{env:{...env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'},
    windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024,...opts});
  let login, loginState = {state:'idle'};
  let cloning = false;
  async function profile() {
    try {
      const {stdout} = await gh(['api','user','--jq','{login,name}']);
      const {login,name} = JSON.parse(stdout);
      return {login,name};
    } catch { return null; }
  }
  function connect() {
    if (login) return loginState;
    loginState = {state:'waiting'};
    const child = spawn(executable,['auth','login','--hostname','github.com','--git-protocol','https','--web','--skip-ssh-key'],
      {env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    login = child;
    let output = '';
    const timer = setTimeout(()=>child.kill(),180000);
    const read = chunk => {
      output = (output+chunk).slice(-1500);
      const code = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0];
      if (code && login===child) loginState = {state:'waiting',code};
    };
    child.stdout.on('data',read); child.stderr.on('data',read);
    child.stdin.on('error',()=>{}); child.stdin.end('\n\n');
    const finish = state => {
      clearTimeout(timer);
      if (login===child) { login=null; loginState={state}; }
    };
    child.on('error',()=>finish('error'));
    child.on('exit',code=>finish(code===0?'connected':'error'));
    return loginState;
  }
  async function repositories() {
    const {stdout} = await gh(['api','user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      '--jq','map({name: .full_name,description: .description,private: .private,branch: .default_branch})']);
    return JSON.parse(stdout);
  }
  async function clone(owner,repository) {
    if (cloning) throw Error('Bir depo zaten kopyalanıyor.');
    if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repository) || /^[.]+$/.test(repository) ||
        /[.]$/.test(repository) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(repository)) throw Error('Depo adı geçersiz.');
    cloning = true;
    try {
      const parent = await chooseFolder();
      if (!parent) return null;
      const target = path.join(parent,repository);
      if (fs.existsSync(target)) throw Error('Bu klasörde aynı isimde bir öğe var. Başka bir konum seç.');
      try { await gh(['repo','clone','https://github.com/'+owner+'/'+repository,target,'--no-upstream'],{timeout:180000}); }
      catch (error) {
        if (/git.*not found|unable to find git|git.*executable/i.test(error.stderr||error.message)) throw Error('Depoyu kopyalamak için Git for Windows kurulmalı.');
        throw Error('Depo kopyalanamadı. GitHub erişimini, bağlantını ve hedef klasörü kontrol et.');
      }
      openWorkspace(target);
      return target;
    } finally { cloning=false; }
  }
  return {
    async action(name,payload) {
      if (name==='profile') return profile();
      if (name==='connect') return connect();
      if (name==='login-state') return loginState;
      if (name==='cancel') { const child=login; login=null; loginState={state:'idle'}; child?.kill(); return loginState; }
      if (name==='repositories') return repositories();
      if (name==='clone') return clone(String(payload?.owner||''),String(payload?.repository||''));
      if (name==='disconnect') {
        const account=await profile();
        if (account) await gh(['auth','logout','--hostname','github.com','--user',account.login]);
        loginState={state:'idle'}; return null;
      }
      throw Error('Bilinmeyen GitHub işlemi.');
    },
    stop() { login?.kill(); }
  };
}
module.exports = createGithub;
