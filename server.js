// kopbri.ai: local web UI that talks to Claude Code or OpenAI Codex CLI.
// Desktop app: main.js (Electron) starts this in-process on a free 127.0.0.1 port.
// Browser only: node tools-local/kopbri/server.js   ->  http://127.0.0.1:3720
// No runtime dependencies. Listens on 127.0.0.1 only. Never touches config.json or any database.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const tokenPolicy = require('./token-policy');
const providerQuota = require('./provider-quota.cjs');
const providerTools = require('./provider-tools.cjs');

const PORT = Number(process.env.PORT || 3720);
const HOST = '127.0.0.1';
let CWD = process.env.AICHAT_CWD || process.cwd();
const TMP = path.join(process.env.KOPBRI_DATA_ROOT || __dirname, '.kopbri', 'tmp', 'images');
const PUBLIC = path.join(__dirname, 'public');
fs.mkdirSync(TMP, { recursive: true });

// ---------- locate the CLIs ----------
function newest(files) {
  return files.filter(f => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}
function globDirs(base, depth) {
  // returns every file path `depth` directory levels below base
  let level = [base];
  for (let i = 0; i < depth; i++) {
    level = level.flatMap(d => { try { return fs.readdirSync(d).map(n => path.join(d, n)); } catch { return []; } });
  }
  return level;
}
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(dir, 'claude.exe');
    if (dir && fs.existsSync(f)) return f;
  }
  const home = os.homedir(), appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const cands = [path.join(home, '.local', 'bin', 'claude.exe')];
  cands.push(...globDirs(path.join(appdata, 'Claude', 'claude-code'), 2).map(d => path.join(d, 'claude.exe')));
  cands.push(...globDirs(path.join(home, '.vscode', 'extensions'), 1)
    .filter(d => /anthropic\.claude-code-/.test(d)).map(d => path.join(d, 'resources', 'native-binary', 'claude.exe')));
  return newest(cands);
}
function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const root = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex');
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const pkg = 'codex-win32-' + process.arch;
  return newest([path.join(root, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', 'codex.exe'), path.join(root, 'vendor', triple, 'bin', 'codex.exe')]);
}
const CLAUDE = providerTools.find('claude') || findClaude();
const CODEX = providerTools.find('codex') || findCodex();
let geminiBundle = path.join(process.env.APPDATA || path.join(os.homedir(),'AppData','Roaming'),'npm','node_modules','@google','gemini-cli','bundle');
const GEMINI = providerTools.find('gemini') || process.env.GEMINI_JS || (fs.existsSync(path.join(geminiBundle,'gemini.js')) ? path.join(geminiBundle,'gemini.js') : null);
if (GEMINI) geminiBundle = path.dirname(GEMINI);
const GEMINI_AUTH=path.join(process.env.KOPBRI_DATA_ROOT || __dirname,'.kopbri','runtime','gemini-auth.cjs');
fs.mkdirSync(path.dirname(GEMINI_AUTH),{recursive:true});
fs.writeFileSync(GEMINI_AUTH,fs.readFileSync(path.join(__dirname,'gemini-auth.cjs')));
let GEMINI_CORE = null;
try { GEMINI_CORE = newest(fs.readdirSync(geminiBundle).filter(n=>/^core-.*\.js$/.test(n)).map(n=>path.join(geminiBundle,n))); } catch {}
const geminiHome = path.join(process.env.KOPBRI_DATA_ROOT || __dirname, '.kopbri','providers','gemini');
const geminiDir = path.join(geminiHome,'.gemini');
const runtimeEnv = process.versions.electron ? {...process.env,ELECTRON_RUN_AS_NODE:'1'} : {...process.env};
const geminiEnv = () => ({...runtimeEnv,GEMINI_CLI_HOME:geminiHome,TEMP:path.dirname(TMP),TMP:path.dirname(TMP)});
const runNode = (args, opts={}) => providerTools.execute(args[0],args.slice(1),{...opts,env:geminiEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']});
function geminiAccount() {
  let loggedIn = !!process.env.GEMINI_API_KEY, name = null;
  try { const auth=JSON.parse(fs.readFileSync(path.join(geminiDir,'oauth_creds.json'),'utf8')); loggedIn=!!(auth.refresh_token || auth.access_token); if(auth.id_token)name=JSON.parse(Buffer.from(auth.id_token.split('.')[1],'base64url').toString()).name || null; } catch {}
  return {found:!!GEMINI,loggedIn,name,path:GEMINI};
}
const hidden = { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
const node = (args, opts = {}) => providerTools.execute(CODEX, args.slice(1), { ...opts, ...hidden });
const nodeSync = args => providerTools.execute(CODEX, args.slice(1), { ...hidden, encoding: 'utf8', timeout: 10000 },true);
const ANSI = /\x1b\[[0-9;]*m/g;

function captureHidden(exe, args) {
  return new Promise(resolve => {
    const child = providerTools.execute(exe, args, hidden); let stdout = '', settled = false;
    const finish = status => { if (settled) return; settled = true; clearTimeout(timer); resolve({ stdout, status }); };
    const timer = setTimeout(() => { child.kill(); finish(-1); }, 10000);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-100000); });
    child.on('error', () => finish(-1)); child.on('close', finish);
  });
}
let statusCache = null, statusAt = 0, statusRequest = null;
function authStatus() {
  if (statusRequest) return statusRequest;
  statusRequest = readAuthStatus().finally(() => { statusRequest = null; }); return statusRequest;
}

async function readAuthStatus() {
  if (statusCache && Date.now() - statusAt < 5000) return statusCache;
  const out = { cwd: CWD, claude: { found: !!CLAUDE, path: CLAUDE, loggedIn: false }, codex: { found: !!CODEX, path: CODEX, loggedIn: false } };
  if (CLAUDE) {
    const r = await captureHidden(CLAUDE, ['auth', 'status']);
    try { const account = JSON.parse(r.stdout); out.claude.loggedIn = !!account.loggedIn; out.claude.name = account.displayName || account.name || null; if (out.claude.loggedIn && !out.claude.name) { try { const profile = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')); out.claude.name = profile.oauthAccount?.displayName || null; } catch {} } } catch { /* not JSON */ }
  }
  if (CODEX) {
    out.codex.loggedIn = (await captureHidden(CODEX, ['login', 'status'])).status === 0;
  }
  if (out.codex.loggedIn) {
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), 'utf8'));
      const token = auth.tokens?.id_token;
      if (token) { const profile = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); out.codex.name = profile.name || null; }
    } catch {}
  }
  out.gemini = geminiAccount();
  for (const e of ['claude', 'codex', 'gemini']) {
    const l = logins[e];
    if (l) out[e].login = { url: l.url, code: l.code, running: l.child.exitCode === null, log: l.log.slice(-600) };
  }
  statusCache = out; statusAt = Date.now(); return out;
}

// ---------- login / logout ----------
// The user signs in on the provider's own page; we only start the CLI flow, show its link and
// pass back the code Claude asks for. No password ever goes through this app.
const logins = {};
function startLogin(engine, email) {
  statusCache = null;
  stopLogin(engine);
  let child;
  if (engine === 'gemini') {
    if (!GEMINI || !GEMINI_CORE) throw new Error('Gemini CLI bulunamadı.');
    fs.mkdirSync(geminiDir,{recursive:true});
    child = runNode([GEMINI_AUTH,GEMINI_CORE,'login']);
  } else if (engine === 'claude') {
    if (!CLAUDE) throw new Error('claude.exe bulunamadi.');
    const args = ['auth', 'login'];
    if (email) args.push('--email', email);
    child = providerTools.execute(CLAUDE, args, hidden);
  } else {
    if (!CODEX) throw new Error('codex bulunamadi.');
    child = node([CODEX, 'login']);
  }
  const l = logins[engine] = { child, log: '', url: null, code: null };
  const onData = d => {
    l.log += String(d).replace(ANSI, '');
    const m = /https:\/\/[^\s<>]+/.exec(l.log);
    if (m && !l.url) {
      l.url = m[0];
      if (engine === 'codex' && email && !/login_hint=/.test(l.url)) l.url += '&login_hint=' + encodeURIComponent(email);
    }
  };
  child.on('close', () => { statusCache = null; });
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', e => { l.log += '\n' + e.message; });
  return new Promise(ok => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (l.url || child.exitCode !== null || Date.now() - t0 > 15000) { clearInterval(tick); ok({ url: l.url, log: l.url ? '' : 'Could not start browser sign-in. Please try again.' }); }
    }, 200);
  });
}
function stopLogin(engine) {
  const l = logins[engine];
  statusCache = null;
  if (l) { killTree(l.child); delete logins[engine]; }
}

// Session ids this app created, so quick exit can delete their transcripts.
const created = { claude: new Set(), codex: new Set(), gemini: new Set() };
function walk(dir, depth, out = []) {
  if (depth < 0) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, depth - 1, out); else out.push(f);
  }
  return out;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function deleteSessions(ids) {
  let n = 0;
  const home = os.homedir();
  const claudeIds = [...new Set([...(ids.claude || []), ...created.claude])].filter(i => UUID.test(i));
  const codexIds = [...new Set([...(ids.codex || []), ...created.codex])].filter(i => UUID.test(i));
  const projects = path.join(home, '.claude', 'projects');
  let projDirs = []; try { projDirs = fs.readdirSync(projects).map(d => path.join(projects, d)); } catch { /* none */ }
  for (const d of projDirs) for (const id of claudeIds) {
    for (const f of [path.join(d, id + '.jsonl'), path.join(d, id)]) {
      if (fs.existsSync(f)) { fs.rmSync(f, { recursive: true, force: true }); n++; }
    }
  }
  if (codexIds.length) {
    for (const f of walk(path.join(home, '.codex', 'sessions'), 4)) {
      if (codexIds.some(id => path.basename(f).includes(id))) { fs.rmSync(f, { force: true }); n++; }
    }
  }
  const geminiIds = [...new Set([...(ids.gemini || []),...created.gemini])].filter(i=>UUID.test(i));
  for(const f of walk(path.join(geminiDir,'tmp'),6)) if(geminiIds.some(id=>path.basename(f).includes(id))) {fs.rmSync(f,{force:true});n++;}
  created.claude.clear(); created.codex.clear(); created.gemini.clear();
  for (const f of walk(TMP, 0)) fs.rmSync(f, { force: true });
  return n;
}
function quickExit(ids) {
  stopLogin('claude'); stopLogin('codex'); stopLogin('gemini');
  for (const c of running) killTree(c);
  const deleted = deleteSessions(ids || {});
  const res = { deleted };
  if (CLAUDE) res.claude = spawnSync(CLAUDE, ['auth', 'logout'], { encoding: 'utf8', timeout: 20000, windowsHide: true }).status === 0;
  if (CODEX) res.codex = nodeSync([CODEX, 'logout']).status === 0;
  if (GEMINI_CORE) res.gemini = providerTools.execute(GEMINI_AUTH,[GEMINI_CORE,'logout'],{env:geminiEnv(),windowsHide:true,timeout:20000,stdio:'ignore'},true).status===0;
  statusCache=null;
  return res;
}
const running = new Set();

// ---------- images ----------
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
function parseImages(images) {
  return (images || []).map(img => {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(img.dataUrl || '');
    if (!m || !EXT[m[1]]) throw new Error('Desteklenmeyen resim: ' + (img.name || '?'));
    return { mime: m[1], b64: m[2] };
  });
}
function saveImages(imgs) {
  return imgs.map(img => {
    const f = path.join(TMP, crypto.randomUUID() + EXT[img.mime]);
    fs.writeFileSync(f, Buffer.from(img.b64, 'base64'));
    return f;
  });
}

// ---------- engines ----------
// Each runner returns the child process; emit(obj) sends one NDJSON event to the browser.
// Saver mode trims what each turn costs: no MCP tool schemas, no skill/command listing,
// stable cacheable system prompt, low effort. Codex: low reasoning effort.
function runClaude({ text, imgs, session, saver, model, folderWrite }, emit) {
  if (!CLAUDE) throw new Error('claude.exe bulunamadi (CLAUDE_BIN ile verin).');
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--include-partial-messages', '--permission-mode', folderWrite?'acceptEdits':'plan'];
  if (folderWrite) args.push('--tools','Read,Glob,Grep,Write,Edit,MultiEdit','--settings',JSON.stringify({permissions:{blockWritesOutsideWorkingDirectories:true}}));
  if (saver) args.push('--strict-mcp-config', '--disable-slash-commands', '--exclude-dynamic-system-prompt-sections', '--effort', 'low');
  if (model) args.push('--model', model);
  if (session) args.push('--resume', session);
  else { session = crypto.randomUUID(); args.push('--session-id', session); }
  created.claude.add(session);
  emit({ t: 'session', id: session });
  const content = imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } }));
  content.push({ type: 'text', text: text || 'Bu resme bak.' });
  const child = providerTools.execute(CLAUDE, args, { cwd: CWD, ...hidden });
  child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  let streamed = false; let liveUsage = {}; 
  lines(child.stdout, ev => {
    if (ev.type === 'stream_event' && ev.event?.type === 'message_start') liveUsage = ev.event.message?.usage || {};
    if (ev.type === 'stream_event' && ev.event?.type === 'message_delta' && ev.event.usage) {
      emit({ t: 'live_usage', input: (liveUsage.input_tokens || 0) + (liveUsage.cache_creation_input_tokens || 0), cached: liveUsage.cache_read_input_tokens || 0, output: ev.event.usage.output_tokens || 0 });
    }
    if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
      streamed = true; emit({ t: 'delta', text: ev.event.delta.text });
    } else if (ev.type === 'stream_event' && ev.event?.type === 'message_start' && streamed) {
      emit({ t: 'delta', text: '\n\n' });
    } else if (ev.type === 'assistant') {
      for (const b of ev.message?.content || []) {
        if (b.type === 'tool_use') { emit({ t: 'tool', name: b.name, detail: toolDetail(b.input) }); if (/write|edit/i.test(b.name) && b.input?.file_path) emit({ t: 'artifact_path', path: b.input.file_path }); }
      }
    } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
      emit({ t: 'limit', info: ev.rate_limit_info });
    } else if (ev.type === 'result') {
      if (ev.is_error) emit({ t: 'error', msg: ev.result || ev.subtype || 'Hata' });
      else if (!streamed && ev.result) emit({ t: 'delta', text: ev.result });
      const u = ev.usage || {};
      emit({ t: 'usage', input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0,
        output: u.output_tokens || 0, cost: ev.total_cost_usd || 0 });
    }
  });
  return child;
}

function runCodex({ text, imgs, session, saver, model, folderWrite }, emit) {
  if (!CODEX) throw new Error('codex bulunamadi (npm i -g @openai/codex).');
  const files = saveImages(imgs);
  const imgArgs = files.map(f => '--image=' + f);
  const common = ['--json', '--skip-git-repo-check'];
  if (saver) common.push('-c', 'model_reasoning_effort="low"', '-c', 'model_verbosity="low"', '-c', 'tool_output_token_limit=1200');
  if (model) common.push('-m', model);
  const args = session
    ? [CODEX, 'exec', 'resume', ...common, '-c', 'sandbox_mode=' + JSON.stringify(folderWrite?'workspace-write':'read-only'), ...imgArgs, session, '-']
    : [CODEX, 'exec', ...common, '-s', folderWrite?'workspace-write':'read-only', '-C', CWD, ...imgArgs, '-'];
  const child = node(args, { cwd: CWD });
  child.stdin.end(text || 'Bu resme bak.');
  let said = false;
  lines(child.stdout, ev => {
    if (ev.type === 'thread.started') { created.codex.add(ev.thread_id); emit({ t: 'session', id: ev.thread_id }); }
    else if (ev.type === 'item.started' && ev.item?.type === 'command_execution') emit({ t: 'tool', name: 'komut', detail: ev.item.command });
    else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
      emit({ t: 'delta', text: (said ? '\n\n' : '') + ev.item.text }); said = true;
    } else if (ev.type === 'error') emit({ t: 'status', msg: ev.message });
    else if (ev.type === 'turn.failed') emit({ t: 'error', msg: ev.error?.message || 'Hata' });
    else if (ev.type === 'turn.completed' && ev.usage) {
      const u = ev.usage, cached = u.cached_input_tokens || 0;
      emit({ t: 'usage', input: Math.max(0, (u.input_tokens || 0) - cached), cached, output: u.output_tokens || 0 });
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'file_change') for (const change of ev.item.changes || []) if (change.path) emit({ t: 'artifact_path', path: change.path });
    // newer Codex builds report plan limits; pass them on in Claude's shape
    const rl = ev.rate_limits || ev.msg?.rate_limits || ev.info?.rate_limits;
    if (rl?.primary) emit({ t: 'limit', info: { utilization: rl.primary.used_percent / 100, resetsAt: rl.primary.resets_at
      || (rl.primary.resets_in_seconds ? Math.round(Date.now() / 1000 + rl.primary.resets_in_seconds) : null),
      rateLimitType: rl.primary.window_minutes ? rl.primary.window_minutes + 'm' : null, status: rl.primary.used_percent >= 100 ? 'rejected' : 'allowed' } });
  });
  child.on('close', () => files.forEach(f => fs.unlink(f, () => {})));
  return child;
}

function runGemini({text,imgs,session,model,folderWrite},emit) {
  if(!GEMINI)throw new Error('Gemini CLI bulunamadı.');
  if(!geminiAccount().loggedIn)throw new Error('Gemini authentication required. Connect your Google account.');
  const files=saveImages(imgs),args=[GEMINI,'--prompt','Complete the request supplied on standard input.','--output-format','stream-json','--approval-mode',folderWrite?'auto_edit':'plan'];
  if(model)args.push('--model',model);
  if(session)args.push('--resume',session);
  // Gemini handles @ references as multimodal attachments, rather than embedding base64 in the prompt.
  const prompt=(files.map(file=>'@'+JSON.stringify(file.replace(/\\/g,'/'))).join(' ')+'\n'+text).trim();
  const child=runNode(args,{cwd:CWD});child.stdin.end(prompt);
  lines(child.stdout,event=>{
    if(event.type==='init'&&UUID.test(event.session_id||'')){created.gemini.add(event.session_id);emit({t:'session',id:event.session_id});}
    else if(event.type==='message'&&event.role==='assistant')emit({t:'delta',text:event.content||''});
    else if(event.type==='tool_use'){emit({t:'tool',name:event.tool_name,detail:toolDetail(event.parameters)});if(/write|edit/.test(event.tool_name||'')&&event.parameters?.file_path)emit({t:'artifact_path',path:event.parameters.file_path});}
    else if(event.type==='result'){
      const u=event.stats||{},cached=u.cached||0;
      emit({t:'usage',input:Math.max(0,(u.input_tokens||u.input||0)-cached),cached,output:Math.max(u.output_tokens||0,(u.total_tokens||0)-(u.input_tokens||u.input||0))});
      if(event.status==='error'||event.error)emit({t:'error',msg:event.error?.message||'Gemini request failed.'});
    }else if(event.type==='error')emit({t:event.severity==='warning'?'status':'error',msg:event.message||'Gemini request failed.'});
  });
  child.on('close',()=>files.forEach(f=>fs.unlink(f,()=>{})));return child;
}
function toolDetail(input) {
  if (!input) return '';
  const v = input.command || input.file_path || input.pattern || input.url || input.description || '';
  return String(v).slice(0, 200);
}
function lines(stream, onJson) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!l) continue;
      try { onJson(JSON.parse(l)); } catch { /* non-JSON line */ }
    }
  });
}
const KILL_GRACE_MS = 3000;
function killTree(child) {
  if (!child) return;
  // Free the slot right away so the next request is not blocked, even if the CLI is slow to exit.
  running.delete(child);
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      console.warn(`killTree: taskkill failed for PID ${pid}: ${r.error ? r.error.message : (r.stderr || r.stdout || '').trim() || 'exit ' + r.status}`);
      try { child.kill(); } catch (e) { console.warn(`killTree: kill failed for PID ${pid}: ${e.message}`); }
    }
    return;
  }
  // Children are spawned detached (own process group) outside Windows, so signal the whole group.
  const signal = sig => {
    try { process.kill(-pid, sig); return; } catch (e) {
      if (e.code !== 'ESRCH') console.warn(`killTree: ${sig} to process group ${pid} failed (${e.code || e.message}); signalling the process only.`);
    }
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { if (!child.kill(sig)) console.warn(`killTree: ${sig} to PID ${pid} was not delivered.`); }
    catch (e) { console.warn(`killTree: ${sig} to PID ${pid} failed: ${e.message}`); }
  };
  signal('SIGTERM');
  // Escalate if anything in the group is still alive after a grace period.
  setTimeout(() => {
    try { process.kill(-pid, 0); } catch { if (child.exitCode !== null || child.signalCode !== null) return; }
    signal('SIGKILL');
  }, KILL_GRACE_MS).unref();
}

// ---------- http ----------
function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > limit) { fail(new Error('Istek cok buyuk')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

// ---------- workspace: <cwd>/.kopbri ----------
// settings.json (app settings), NOTES.md (the user's important notes, engines are pointed at it),
// LOG.md (one line per turn: which engine did what, with which model, for how many tokens).
const wsDir = (cwd=CWD) => path.join(cwd, '.kopbri');
const NOTES_TEMPLATE = '# kopbri.ai notları\n\nÖnemli bilgiler, kararlar ve hatırlatmalar. kopbri.ai her yeni oturumda motorlara bu dosyayı gösterir.\n\n';
function ensureWorkspace(cwd=CWD) {
  const d = wsDir(cwd);
  try {
    fs.mkdirSync(d, { recursive: true });
    const init = (name, text) => { const f = path.join(d, name); if (!fs.existsSync(f)) fs.writeFileSync(f, text, 'utf8'); };
    init('settings.json', '{}\n');
    init('NOTES.md', NOTES_TEMPLATE);
    init('LOG.md', '# kopbri.ai iş günlüğü\n\nHer mesaj için: zaman · motor (model) · token · istek.\n\n');
    return { dir: d, ok: true };
  } catch (e) { return { dir: d, ok: false, error: e.message }; }
}
function readWs(name,cwd=CWD) { try { return fs.readFileSync(path.join(wsDir(cwd), name), 'utf8'); } catch { return ''; } }
function logTurn({ engine, model, title, files, tokens, error },cwd=CWD) {
  const t = new Date(), pad = n => String(n).padStart(2, '0');
  const when = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const who = ({codex:'Codex',claude:'Claude Code',gemini:'Gemini'}[engine] || engine) + (model ? ` (${model})` : '');
  const what = String(title || '(sadece ek)').replace(/\s+/g, ' ').slice(0, 160).replace(/\|/g, '/');
  const extra = (files?.length ? ` · ekler: ${files.slice(0, 5).join(', ')}` : '') + (error ? ' · HATA' : '');
  try { ensureWorkspace(cwd); fs.appendFileSync(path.join(wsDir(cwd), 'LOG.md'), `- ${when} · ${who} · ${tokens ? Math.round(tokens / 100) / 10 + 'k token' : '-'} · ${what}${extra}\n`, 'utf8'); } catch { /* read-only folder */ }
}

// Only files inside the selected workspace may be displayed or revealed.
function workspaceFile(relative) {
  const root = fs.realpathSync(CWD), target = fs.realpathSync(path.resolve(root, String(relative || '')));
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || rel.split(path.sep).some(p => /^(node_modules|\.git|\.env|auth\.json|credentials)/i.test(p))) throw new Error('File is outside the preview workspace');
  const parts=rel.split(path.sep);if((parts[0]==='.kopbri'&&['providers','desktop','runtime','backups'].includes(parts[1]))||parts.some(p=>/^(oauth_creds|credentials)\.json$/i.test(p)))throw new Error('Private application data cannot be previewed');
  if (!fs.statSync(target).isFile()) throw new Error('Not a file');
  return { target, relative: rel };
}
function artifactInfo(file) {
  const {target, relative} = workspaceFile(file), ext = path.extname(target).toLowerCase();
  const kind = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(ext) ? 'image' : ext === '.pdf' ? 'pdf' : /\.(txt|md|markdown|json|csv|log|js|ts|css|xml|yml|yaml|py|sql)$/.test(ext) ? 'text' : 'file';
  return { path: relative.replace(/\\/g, '/'), name: path.basename(target), kind, bytes: fs.statSync(target).size };
}
function loadLedger(cwd=CWD) {
  try{return JSON.parse(readWs('usage.json',cwd));}catch{}
  const ledger={days:{},contexts:{}};
  try{const previous=JSON.parse(readWs('history.json',cwd)).usage||{};for(const engine of ['claude','codex','gemini'])for(const row of previous[engine]?.ev||[]){const date=new Date(row[0]),day=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');ledger.days[day]||={};const entry=ledger.days[day][engine]||={total:0,input:0,output:0,cached:0};entry.total+=row[1]||0;entry.input+=row[2]||0;entry.output+=row[3]||0;entry.cached+=row[4]||0;}}catch{}
  try{ensureWorkspace(cwd);fs.writeFileSync(path.join(wsDir(cwd),'usage.json'),JSON.stringify(ledger));}catch{}
  return ledger;
}
function workspaceSettings() {try{return JSON.parse(readWs('settings.json'));}catch{return {};}}
function dayKey() {const date=new Date();return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
function preflight(body) {
  const settings=workspaceSettings(),policy=tokenPolicy.settings(settings.tokens),ledger=loadLedger();
  let fileBytes=0;for(const file of (body.filePaths||[]).slice(0,30)){try{const stat=fs.statSync(file);if(stat.isFile())fileBytes+=stat.size;}catch{}}
  const context=body.session ? ledger.contexts?.[body.session] || 0 : 0;
  const estimate=tokenPolicy.estimate({text:body.text,imageCount:body.imageCount??body.images?.length??0,fileBytes,context,engine:body.engine});
  const spent=ledger.days?.[dayKey()]?.[body.engine]?.total||0,budget=Math.max(0,Number(settings.budget?.[body.engine])||0);
  const remaining=budget?Math.max(0,budget-spent):null;
  const reason=estimate.total>policy.requestLimit?'request':remaining!==null&&estimate.total+policy.outputTarget>remaining?'daily':null;
  const reset=providerQuota.until(body.engine);
  return {ok:!reason&&!reset,reason:reason || (reset?'provider':null),estimate,policy,spent,budget,remaining,reset};
}
function recordTurnUsage(engine,session,value,cwd=CWD) {
  const u=tokenPolicy.usage(value);if(!u.total)return;
  const ledger=loadLedger(cwd),day=dayKey();ledger.days ||= {};ledger.contexts ||= {};ledger.days[day] ||= {};
  const total=ledger.days[day][engine] ||= {input:0,output:0,cached:0,total:0};for(const key of Object.keys(total))total[key]+=(u[key]||0);
  if(session)ledger.contexts[session]=u.total;
  const keys=Object.keys(ledger.days).sort();for(const key of keys.slice(0,-8))delete ledger.days[key];
  const contextKeys=Object.keys(ledger.contexts);for(const key of contextKeys.slice(0,-200))delete ledger.contexts[key];
  try{ensureWorkspace(cwd);const file=path.join(wsDir(cwd),'usage.json');fs.writeFileSync(file+'.tmp',JSON.stringify(ledger));fs.renameSync(file+'.tmp',file);}catch{}
}
async function chat(req, res) {
  const body = JSON.parse(await readBody(req));
  if(!['claude','codex','gemini'].includes(body.engine)){res.writeHead(400);return res.end(JSON.stringify({error:'Unknown provider'}));}
  if(running.size){res.writeHead(409);return res.end(JSON.stringify({error:'Another request is already running.'}));}
  if (body.workspace && body.workspace!==CWD) {
    res.writeHead(409,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({error:'Bu görev için kayıtlı çalışma klasörünü aç.'}));
  }
  const turnCwd = CWD;
  const guard=preflight(body);
  if(!guard.ok){res.writeHead(422,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:guard.reason==='daily'?'Daily token budget would be exceeded.':guard.reason==='provider'?'Provider rate limit is active.':'Estimated input exceeds the per-request token limit.',guard}));}
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  let tokens = 0, failed = false, responseText = '', finalUsage=null, currentSession=body.session||null; const artifactPaths = new Set(), delivered = new Set();
  const publishArtifacts = () => { for (const file of artifactPaths) { try { const info = artifactInfo(file); if (!delivered.has(info.path)) { delivered.add(info.path); res.write(JSON.stringify({ t: 'artifact', file: info }) + '\n'); } } catch {} } };
  const emit = o => {
    if (o.t === 'limit' && o.info) providerQuota.record(body.engine,o.info);
    if (o.t === 'artifact_path') { artifactPaths.add(o.path); return; }
    if (o.t === 'delta') {
      responseText += o.text;
      for (const match of responseText.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        let file = match[1].replace(/^<|>$/g, '');
        if (!/^https?:/i.test(file)) { try { artifactPaths.add(decodeURIComponent(file.replace(/^sandbox:/, ''))); } catch {} }
      }
    }
    if(o.t==='session')currentSession=o.id;
    if (o.t === 'usage') {finalUsage=o;tokens=tokenPolicy.usage(o).total;}
    if (o.t === 'error') failed = true;
    if (!res.writableEnded) res.write(JSON.stringify(o) + '\n');
  };
  let child;
  const model = /^[\w.\-]{1,60}$/.test(body.model || '') ? body.model : null;
  try {
    ensureWorkspace();
    let text = String(body.text || '');
    if(body.saver!==false)text='[kopbri] Be concise; target about '+guard.policy.outputTarget+' output tokens unless completeness requires more. Do not repeat the question. Search narrowly and read only relevant file sections. Avoid repeated tool output, whole-repository scans and unnecessary tools. Preserve important requirements.\n\n'+text;
    if (!body.session && readWs('NOTES.md').trim() !== NOTES_TEMPLATE.trim()) text = '[kopbri] Proje notlari .kopbri/NOTES.md dosyasinda; konuyla ilgiliyse oku.\n\n' + text;
    const folderWrite = Object.hasOwn(body,'folderGrant') && require('./folder-access.cjs').allowed(CWD,body.engine,body.folderGrant);
    if (Object.hasOwn(body,'folderGrant') && !folderWrite) throw new Error('Klasör izni geçersiz veya süresi dolmuş.');
    const job = { text, folderWrite, imgs: parseImages(body.images), session: body.session || null, saver: body.saver !== false, model };
    child = body.engine === 'codex' ? runCodex(job, emit) : body.engine === 'gemini' ? runGemini(job,emit) : runClaude(job, emit);
    emit({t:'guard',estimate:guard.estimate,policy:guard.policy});
  } catch (e) { emit({ t: 'error', msg: e.message }); emit({ t: 'done' }); return res.end(); }
  child.on('close', () => {if(finalUsage)recordTurnUsage(body.engine,currentSession,finalUsage,turnCwd);});
  child.on('close', () => logTurn({ engine: body.engine, model, title: body.title, files: body.files, tokens, error: failed },turnCwd));
  running.add(child);
  // 'exit' fires even if a leftover grandchild keeps the pipes (and so 'close') open.
  child.on('exit', () => running.delete(child));
  child.on('close', () => running.delete(child));
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  res.on('close', () => killTree(child));
  child.on('error', e => {emit({ t: 'error', msg: e.message });});
  child.on('close', code => {
    if (code && code !== 0) {
      if (!failed) emit({ t: 'error', msg: 'Provider exited before completing the request (' + code + ').' });
      const tail = stderr.split('\n').filter(l => l && !/responses_websocket/.test(l)).slice(-3).join('\n');
      if (tail) emit({ t: 'status', msg: tail });
    }
    publishArtifacts(); if(!responseText&&!delivered.size&&!failed)emit({t:'error',msg:'Provider returned no response.'}); emit({ t: 'done', code }); res.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // Only our own page may call us: right Host (no DNS rebinding) and, for POST, a custom
    // header that other web pages cannot send without a CORS preflight we never answer.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '') || (req.method === 'POST' && req.headers['x-bb'] !== '1')) {
      res.writeHead(403); return res.end('Forbidden');
    }
    const url = new URL(req.url, 'http://x');
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && url.pathname === '/api/transcribe') return await require('./speech-transcribe.cjs')(req,res,url.searchParams.get('partial')==='1',url.searchParams.get('names') || '',url.searchParams.get('quality')==='accurate');
    if (req.method === 'POST' && url.pathname === '/api/live-dictation') return await require('./live-dictation.cjs').handle(req,res,url);
    if (req.method === 'POST' && url.pathname === '/api/voice-ready') {
      require('./natural-voice.cjs').warm().catch(error=>console.warn('kopbri voice warmup:',error.message));
      res.writeHead(202); return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/speak') {
      const data = JSON.parse(await readBody(req));
      if (typeof data.text!=='string' || !data.text.trim() || data.text.length>2200) {
        res.writeHead(400); return res.end();
      }
      const controller = new AbortController();
      res.once('close',() => { if (!res.writableEnded) controller.abort(); });
      try {
        const audio = await require('./speech-playback.cjs')(data.text,controller.signal,data.profile,data.language);
        if (!res.destroyed) {
          res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});
          res.end(audio);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('kopbri voice playback:',error.code || error.name);
          res.writeHead(503); res.end();
        }
      }
      return;
    }
    if (url.pathname === '/api/office') {
      const file = path.join(process.env.KOPBRI_DATA_ROOT || __dirname,'.kopbri','agent-office.json');
      if (req.method === 'GET') {
        try { return json(JSON.parse(fs.readFileSync(file,'utf8'))); } catch { return json(null); }
      }
      if (req.method === 'POST') {
        const data = JSON.parse(await readBody(req));
        if (!Array.isArray(data.agents) || data.agents.length > 200 || data.agents.some(agent=>!agent || typeof agent.name!=='string') || data.agents.filter(agent=>!agent.archived).length > 10 || !Array.isArray(data.tasks) || !Array.isArray(data.messages)) {
          res.writeHead(400); return res.end();
        }
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(file+'.tmp',JSON.stringify(data),'utf8');
        fs.renameSync(file+'.tmp',file);
        return json({ok:true});
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') return await chat(req, res);

    if (req.method === 'GET' && url.pathname === '/api/artifact') {
      const file = workspaceFile(url.searchParams.get('path')), info = artifactInfo(file.relative);
      if (url.searchParams.has('info')) return json(info);
      const ext = path.extname(file.target).toLowerCase();
      const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.bmp':'image/bmp', '.ico':'image/x-icon', '.pdf':'application/pdf' }[ext] || 'text/plain; charset=utf-8';
      if (info.kind === 'file') { res.writeHead(415); return res.end('Preview unavailable'); }
      if (info.kind === 'text' && info.bytes > 2 * 1024 * 1024) { res.writeHead(413); return res.end('Text preview is limited to 2 MB'); }
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control':'no-store' });
      return fs.createReadStream(file.target).pipe(res);
    }
    if(req.method==='GET'&&url.pathname==='/api/models') {
      let codex=[];try{const cache=JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),'models_cache.json'),'utf8'));codex=(cache.models||[]).filter(m=>typeof m.slug==='string'&&m.visibility!=='hide'&&m.visibility!=='hidden').slice(0,15).map(m=>[m.slug,m.display_name||m.slug,m.description||'']);}catch{}
      return json({codex});
    }
    if(req.method==='POST'&&url.pathname==='/api/preflight'){const body=JSON.parse(await readBody(req));if(body.workspace && body.workspace!==CWD){res.writeHead(409);return res.end();}return json(preflight(body));}
    if(req.method==='GET'&&url.pathname==='/api/usage')return json(loadLedger());
    if (req.method === 'GET' && url.pathname === '/api/status') return json(await authStatus());
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const b = JSON.parse(await readBody(req));
      return json(await startLogin(['claude','codex','gemini'].includes(b.engine) ? b.engine : 'claude', String(b.email || '').trim()));
    }
    if (req.method === 'POST' && url.pathname === '/api/login/code') {
      const b = JSON.parse(await readBody(req)), l = logins[b.engine];
      if (!l || l.child.exitCode !== null) return json({ ok: false, msg: 'Giris islemi calismiyor, yeniden baslatin.' });
      l.child.stdin.write(String(b.code || '').trim() + '\n');
      return json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/login/cancel') {
      const b = JSON.parse(await readBody(req)); stopLogin(b.engine); return json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/exit') {
      const result = quickExit(JSON.parse(await readBody(req)));
      fs.rmSync(path.join(wsDir(), 'history.json'), { force: true }); fs.rmSync(path.join(wsDir(),'usage.json'),{force:true}); return json(result);
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      ensureWorkspace(); let data = { chats: [], active: null, usage: null };
      try { data = JSON.parse(readWs('history.json')) || data; } catch {}
      return json(data);
    }
    if (req.method === 'POST' && url.pathname === '/api/history') {
      const b = JSON.parse(await readBody(req)); ensureWorkspace();
      if (!Array.isArray(b.chats) || b.chats.length > 200) throw new Error('Invalid history');
      const file = path.join(wsDir(), 'history.json');
      fs.writeFileSync(file + '.tmp', JSON.stringify(b), 'utf8'); fs.renameSync(file + '.tmp', file);
      return json({ ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/workspace') {
      const w = ensureWorkspace();
      let settings = {}; try { settings = JSON.parse(readWs('settings.json') || '{}'); } catch { /* broken file: start clean */ }
      return json({ ...w, cwd: CWD, settings, notes: readWs('NOTES.md'), log: readWs('LOG.md').split('\n').filter(l => l.startsWith('- ')).slice(-60).reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/api/workspace') {
      const b = JSON.parse(await readBody(req)); ensureWorkspace();
      if (b.settings && typeof b.settings === 'object') fs.writeFileSync(path.join(wsDir(), 'settings.json'), JSON.stringify(b.settings, null, 2) + '\n', 'utf8');
      if (typeof b.notes === 'string') fs.writeFileSync(path.join(wsDir(), 'NOTES.md'), b.notes, 'utf8');
      return json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/sizes') {
      // byte sizes of attached files, for the token estimate
      const b = JSON.parse(await readBody(req));
      return json((b.paths || []).map(p => { try { return fs.statSync(p).size; } catch { return 0; } }));
    }
    if (req.method === 'GET') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname === '/logo' ? 'logo.svg' : url.pathname.slice(1);
      const f = path.join(PUBLIC, path.normalize(name));
      if (f.startsWith(PUBLIC) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(f)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        return fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e.message));
  }
});
// start({ port, cwd }) -> Promise<port>; port 0 picks a free one (desktop app).
function start({ port = PORT, cwd } = {}) {
  if (cwd && fs.existsSync(cwd)) CWD = cwd;
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, () => {
      const p = server.address().port;
      console.log(`kopbri.ai: http://${HOST}:${p}`);
      console.log(`Calisma klasoru: ${CWD}`);
      console.log(`Claude: ${CLAUDE || 'bulunamadi'}`);
      console.log(`Codex : ${CODEX || 'bulunamadi'}`);
      ok(p);
      setTimeout(() => { require('./live-dictation.cjs').warm().catch(error=>console.warn('Canlı dikte:',error.message)); },300).unref();
    });
  });
}
function shutdown() {
  require('./live-dictation.cjs').stop();
  for (const c of running) killTree(c);
  stopLogin('claude'); stopLogin('codex'); stopLogin('gemini');
  server.close();
}
function setCwd(dir) { if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) { if (CWD!==dir) require('./folder-access.cjs').reset(); CWD = dir; statusCache = null; ensureWorkspace(); } return CWD; }
module.exports = { start, shutdown, setCwd, getCwd: () => CWD };
if (require.main === module) start();
