'use strict';

const blockedUntil = new Map();

function record(engine,info,now=Date.now()) {
  const raw = Number(info.utilization ?? info.used_percent ?? info.usedPercent);
  const fraction = Number.isFinite(raw) && (info.utilization != null ? raw >= 1 : raw >= 100);
  if (info.status!=='rejected' && !fraction) return;
  const value = Number(info.resetsAt ?? info.resets_at);
  const reset = value>0 && value<1e12 ? value*1000 : value;
  if (reset>now) blockedUntil.set(engine,Math.max(blockedUntil.get(engine) || 0,reset));
  else if (info.status==='rejected') blockedUntil.set(engine,Math.max(blockedUntil.get(engine) || 0,now+60000));
}

function until(engine,now=Date.now()) {
  const reset=blockedUntil.get(engine);
  if (reset>now) return reset;
  blockedUntil.delete(engine);
  return null;
}

module.exports = {record,until};
