'use strict';
const path = require('node:path');
const root = __dirname.includes('app.asar') && process.resourcesPath
  ? path.join(process.resourcesPath,'speech','supertonic') : path.join(__dirname,'.kopbri','speech','supertonic');
let engine;
let queue = Promise.resolve();
function load() {
  engine ??= import('./supertonic-helper.mjs').then(async api => ({
    tts:await api.loadTextToSpeech(path.join(root,'onnx'),false),
    feminine:api.loadVoiceStyle([path.join(root,'voice_styles','F1.json')],false),
    masculine:api.loadVoiceStyle([path.join(root,'voice_styles','M1.json')],false)
  })).catch(error=>{ engine=null; throw error; });
  return engine;
}
function wave(samples,rate) {
  const result = Buffer.alloc(44+samples.length*2);
  result.write('RIFF',0); result.writeUInt32LE(result.length-8,4); result.write('WAVEfmt ',8);
  result.writeUInt32LE(16,16); result.writeUInt16LE(1,20); result.writeUInt16LE(1,22);
  result.writeUInt32LE(rate,24); result.writeUInt32LE(rate*2,28);
  result.writeUInt16LE(2,32); result.writeUInt16LE(16,34); result.write('data',36);
  result.writeUInt32LE(samples.length*2,40);
  for (let i=0;i<samples.length;i++) result.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);
  return result;
}
function synthesize(text,signal,language='tr',profile='feminine') {
  const job = queue.then(async () => {
    signal?.throwIfAborted();
    const {tts,feminine,masculine} = await load();
    signal?.throwIfAborted();
    const {wav,duration} = await tts.call(text,language==='en'?'en':'tr',profile==='masculine'?masculine:feminine,8,1.05);
    signal?.throwIfAborted();
    return wave(wav.slice(0,Math.floor(tts.sampleRate*duration[0])),tts.sampleRate);
  });
  queue = job.catch(()=>{});
  return job;
}
module.exports = synthesize;
module.exports.warm = load;
