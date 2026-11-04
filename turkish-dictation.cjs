'use strict';
const path = require('node:path');
const {fork}=require('node:child_process');
const modelRoot = __dirname.includes('app.asar') && process.resourcesPath
  ? path.join(process.resourcesPath,'speech','ufakzeka') : path.join(__dirname,'.kopbri','speech','ufakzeka');
let worker, ready, serial=0;
const pending=new Map();
function launch() {
  if(worker?.connected)return;
  const node=require('./provider-tools.cjs').nodeRuntime()?.node || process.execPath;
  const entry=path.join(__dirname,'turkish-dictation-worker.cjs').replace(/app\.asar(?=[\\/])/,'app.asar.unpacked');
  const env={...process.env,KOPBRI_ASR_MODELS:modelRoot};
  if(node===process.execPath && process.versions.electron)env.ELECTRON_RUN_AS_NODE='1';
  else delete env.ELECTRON_RUN_AS_NODE;
  const child=fork(entry,[],{execPath:node,env,windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','inherit','ipc']});
  worker=child;
  child.on('message',message=>{
    const call=pending.get(message.id);
    if(!call)return;
    pending.delete(message.id);clearTimeout(call.timer);
    if(message.error)call.reject(Error(message.error));else call.resolve(message.result);
  });
  function unavailable(error) {
    if(worker!==child)return;
    worker=null;ready=null;
    for(const call of pending.values()){clearTimeout(call.timer);call.reject(error);}
    pending.clear();
  }
  child.on('error',unavailable);
  child.on('exit',code=>unavailable(Error('Türkçe dikte işlemi kapandı ('+code+').')));
}
function request(action,pcm) {
  launch();
  return new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Türkçe dikte zaman aşımına uğradı.'));},15000);
    pending.set(id,{resolve,reject,timer});
    worker.send({id,action,pcm},error=>{
      if(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  });
}
function warm() { return ready ??= request('warm').catch(error=>{ready=null;throw error;}); }
async function decode(chunks) { await warm();return request('decode',Buffer.concat(chunks)); }
function stop(){worker?.kill();}
module.exports = {warm,decode,stop};
