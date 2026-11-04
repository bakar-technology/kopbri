'use strict';
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const providers = new Set(['claude','codex','gemini']);
const grants = new Map();
let approvedFolder;
function resolveFolder(cwd) { try { return fs.realpathSync(cwd); } catch { return null; } }
function manage(cwd,mode,engine) {
  const folder = resolveFolder(cwd);
  if (!folder || !providers.has(engine)) return null;
  if (mode==='status') return {folder,approved:approvedFolder===folder};
  if (mode==='revoke') { approvedFolder = null; grants.clear(); return {folder,approved:false}; }
  if (mode==='session') { approvedFolder = folder; return {folder,approved:true}; }
  if (mode==='once') {
    const token = randomUUID();
    const now = Date.now();
    for (const [key,value] of grants) if (value.expires<now) grants.delete(key);
    grants.set(token,{folder,engine,expires:now+60000});
    return {folder,token};
  }
  return null;
}
function allowed(cwd,engine,token) {
  const folder = resolveFolder(cwd);
  if (!folder) return false;
  if (approvedFolder===folder) return true;
  if (typeof token!=='string') return false;
  const grant = grants.get(token);
  grants.delete(token);
  return Boolean(grant && grant.folder===folder && grant.engine===engine && grant.expires>=Date.now());
}
function reset() { approvedFolder = null; grants.clear(); }
module.exports = {manage,allowed,reset};
