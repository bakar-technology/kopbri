'use strict';
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const sessions = new Map();
let api, model;
let turkish;
let ready;
async function load() {
  try { turkish=require('./turkish-dictation.cjs'); await turkish.warm(); }
  catch(error) { turkish=null; console.warn('Türkçe dikte:',error.message); }
  try { loadVosk(); }
  catch(error) { if(!turkish)throw error; console.warn('Ajan adı tanıma:',error.message); }
}
function loadVosk() {
  if (model) return;
  const root = __dirname.includes('app.asar') && process.resourcesPath
    ? path.join(process.resourcesPath,'speech','vosk') : path.join(__dirname,'.kopbri','speech','vosk');
  const library = require('koffi').load(path.join(root,'libvosk.dll'));
  const fn = definition => library.func(definition);
  api = {
    create:fn('void *vosk_model_new(const char *path)'),
    log:fn('void vosk_set_log_level(int level)'),
    start:fn('void *vosk_recognizer_new(void *model, float rate)'),
    accept:fn('int vosk_recognizer_accept_waveform(void *recognizer, const uint8_t *data, int length)'),
    result:fn('const char *vosk_recognizer_result(void *recognizer)'),
    partial:fn('const char *vosk_recognizer_partial_result(void *recognizer)'),
    final:fn('const char *vosk_recognizer_final_result(void *recognizer)'),
    close:fn('void vosk_recognizer_free(void *recognizer)')
  };
  api.log(-1);
  model = api.create(path.join(root,'vosk-model-small-tr-0.3'));
  if (!model) throw Error('Türkçe canlı dikte modeli açılamadı.');
}
function warm(){return ready ??= load();}
function close(id) {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.timer);
  if (session.recognizer) api.close(session.recognizer);
  if (session.prefix) api.close(session.prefix);
  sessions.delete(id);
}
function prefixText(session,final=false) {
  if(!session.prefix)return;
  const data=JSON.parse(final?api.final(session.prefix):api.partial(session.prefix));
  const text=data.text || data.partial;
  if(text)session.prefixName=findAddress(session,text) || session.prefixName;
}
function findAddress(session,value) {
  const start=value.toLocaleLowerCase('tr').trim().replace(/^(?:hey|selam|merhaba)[\s,]+/,'')
    .match(/^\p{L}+(?:[ '-]\p{L}+)*/u)?.[0]||'';
  return session.names.find(name=>{
    const word=name.toLocaleLowerCase('tr');
    return start===word || start.startsWith(word+' ');
  });
}
function withAddress(session,text) {
  return text && session.prefixName && !findAddress(session,text) ? session.prefixName+', '+text : text;
}
function keepAlive(id,session) {
  clearTimeout(session.timer);
  session.timer = setTimeout(()=>close(id),35000);
  session.timer.unref();
}
async function handle(req,res,url) {
  const reply = (status,data) => {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  };
  try {
    const id = url.searchParams.get('id');
    const action = url.searchParams.get('action');
    if (action==='start') {
      await warm();
      if (sessions.size>=6) return reply(429,{error:'Bir dikte oturumu zaten açık.'});
      const id = randomUUID();
      const recognizer = turkish ? null : api.start(model,16000);
      if (!turkish && !recognizer) throw Error('Canlı dikte başlatılamadı.');
      const names=(url.searchParams.get('names')||'').split(',').map(name=>name.trim()).filter(Boolean).slice(0,10);
      const prefix=turkish && model && names.length ? api.start(model,16000) : null;
      const session = turkish ? {chunks:[],bytes:0,decoded:0,text:'',names,prefix,prefixBytes:0,prefixName:''} : {recognizer,segments:[]};
      sessions.set(id,session); keepAlive(id,session);
      return reply(200,{id,engine:turkish?'ufakzeka':'vosk'});
    }
    const session = sessions.get(id);
    if (!session) return reply(404,{error:'Dikte oturumu kapanmış.'});
    if (action==='cancel') { close(id); return reply(200,{}); }
    if (action==='finish') {
      if (session.chunks) {
        if(session.prefix && session.prefixBytes<64000)prefixText(session,true);
        const text = session.bytes===session.decoded ? session.text : await turkish.decode(session.chunks) || session.text;
        const addressed=withAddress(session,text);
        close(id); return reply(200,{text:addressed});
      }
      const result = JSON.parse(api.final(session.recognizer));
      const text = [...session.segments,result.text].filter(Boolean).join(' ');
      close(id); return reply(200,{text});
    }
    if (action!=='audio') return reply(400,{error:'Bilinmeyen dikte işlemi.'});
    const size = Number(req.headers['content-length']);
    if (!(size>0 && size<=65536 && size%2===0)) { req.resume(); return reply(400,{error:'Geçersiz ses parçası.'}); }
    const pieces = [];
    for await (const piece of req) pieces.push(piece);
    const data = Buffer.concat(pieces);
    if (data.length!==size || sessions.get(id)!==session) return reply(400,{error:'Ses parçası alınamadı.'});
    if (session.chunks) {
      session.chunks.push(data); session.bytes+=data.length;
      if (session.bytes>850000) { close(id); return reply(413,{error:'Ses kaydı çok uzun.'}); }
      if(session.prefix && session.prefixBytes<64000) {
        const first=data.subarray(0,64000-session.prefixBytes);
        session.prefixBytes+=first.length;
        if(api.accept(session.prefix,first,first.length)>0) {
          const result=JSON.parse(api.result(session.prefix)).text;
          if(result)session.prefixName=findAddress(session,result)||session.prefixName;
        } else prefixText(session,session.prefixBytes>=64000);
      }
      if (session.bytes-session.decoded >= (session.decoded ? 24000 : 19200)) {
        session.text=await turkish.decode(session.chunks) || session.text;
        session.decoded=session.bytes;
      }
      keepAlive(id,session);
      return reply(200,{text:withAddress(session,session.text)});
    }
    const done = api.accept(session.recognizer,data,data.length);
    if (done<0) throw Error('Ses parçası işlenemedi.');
    if (done) {
      const text = JSON.parse(api.result(session.recognizer)).text;
      if (text) session.segments.push(text);
    }
    const partial = done ? '' : JSON.parse(api.partial(session.recognizer)).partial;
    keepAlive(id,session);
    return reply(200,{text:[...session.segments,partial].filter(Boolean).join(' ')});
  } catch (error) {
    return reply(503,{error:error.message});
  }
}
module.exports = {handle,warm,stop(){turkish?.stop();}};
