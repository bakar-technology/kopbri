'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const run = promisify(execFile);
const runtime = __dirname.includes('app.asar') && process.resourcesPath
  ? path.join(process.resourcesPath,'speech') : path.join(__dirname,'.kopbri','speech');
const limit = 850000;

async function transcribe(req,res,partial=false,names='',accurate=false) {
  const language = new URL(req.url,'http://localhost').searchParams.get('language')==='en' ? 'en' : 'tr';
  function reply(status,data) {
    if (res.destroyed) return;
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  }
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close',cancel);
  let temp;
  try {
    const declaredLength = Number(req.headers['content-length']);
    if (req.headers['content-type']!=='audio/wav' || !(declaredLength>44 && declaredLength<=limit)) {
      req.resume(); return reply(400,{error:'Kayıt boş veya geçersiz.'});
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size>limit) return reply(413,{error:'Ses kaydı çok uzun.'});
      chunks.push(chunk);
    }
    const wave = Buffer.concat(chunks);
    if (wave.toString('ascii',0,4)!=='RIFF' || wave.toString('ascii',8,12)!=='WAVE') {
      return reply(400,{error:'Ses kaydı okunamadı.'});
    }
    if (wave.toString('ascii',36,40)==='data' && wave.readUInt16LE(22)===1 && wave.readUInt16LE(34)===16) {
      let sound = false, sum = 0, count = 0;
      for (let i=44;i+1<wave.length;i+=2) {
        const sample = wave.readInt16LE(i);
        sum += sample*sample; count++;
        if (count===1600) {
          if (sum/count>10000) { sound = true; break; }
          sum = 0; count = 0;
        }
      }
      if (!sound) return reply(200,{text:''});
    }
    const exe = path.join(runtime,'whisper-cli.exe');
    const model = path.join(runtime,partial && !accurate?'ggml-base-q5_1.bin':'ggml-small-q5_1.bin');
    try { await Promise.all([fs.access(exe),fs.access(model)]); }
    catch { return reply(503,{error:'Çevrimdışı Türkçe ses modeli bu kurulumda bulunamadı.'}); }
    temp = await fs.mkdtemp(path.join(os.tmpdir(),'kopbri-voice-'));
    const input = path.join(temp,'voice.wav'), output = path.join(temp,'text');
    await fs.writeFile(input,wave);
    const hints = names.slice(0,330).replace(/[^\p{L}\p{N}\s,'-]/gu,'');
    const args = ['-m',model,'-f',input,'-l',language,'-ng','-otxt','-of',output];
    if (hints) args.push('--prompt',(language==='en'?'Agent names: ':'Ajan isimleri: ')+hints+'.');
    await run(exe,args,{
      signal:controller.signal,timeout:90000,windowsHide:true,maxBuffer:1048576,cwd:runtime
    });
    reply(200,{text:(await fs.readFile(output+'.txt','utf8')).trim()});
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Kopbri transcription failed:',error.code || error.name);
      reply(500,{error:'Ses cihazda yazıya çevrilemedi.'});
    }
  } finally {
    res.removeListener('close',cancel);
    if (temp) await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports = transcribe;
