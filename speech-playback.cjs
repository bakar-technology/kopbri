'use strict';
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const speechRoot = __dirname.includes('app.asar') && process.resourcesPath
  ? path.join(process.resourcesPath,'speech') : path.join(__dirname,'.kopbri','speech');
const runtime = path.join(speechRoot,'piper');
const voice = path.join(runtime,'tr_TR-dfki-medium.onnx');

function trimSentence(wave) {
  if(wave.length<44 || wave.toString('ascii',0,4)!=='RIFF')return wave;
  let rate=0, dataStart=0, dataSize=0;
  for(let i=12;i+8<=wave.length;){
    const name=wave.toString('ascii',i,i+4),size=wave.readUInt32LE(i+4),offset=i+8;
    if(offset+size>wave.length)return wave;
    if(name==='fmt ' && size>=16 && wave.readUInt16LE(offset)===1 &&
       wave.readUInt16LE(offset+2)===1 && wave.readUInt16LE(offset+14)===16)rate=wave.readUInt32LE(offset+4);
    if(name==='data'){dataStart=offset;dataSize=size;break;}
    i=offset+size+(size%2);
  }
  if(!rate || !dataStart || dataSize<rate*.3)return wave;
  const frames=Math.floor(dataSize/2),step=Math.max(1,Math.round(rate*.01));
  let first=-1,last=-1;
  for(let start=0;start<frames;start+=step){
    const end=Math.min(frames,start+step);
    let sum=0;
    for(let i=start;i<end;i++){const value=wave.readInt16LE(dataStart+i*2);sum+=value*value;}
    if(sum/(end-start)>14400){if(first<0)first=start;last=end;}
  }
  if(first<0)return wave;
  first=Math.max(0,first-Math.round(rate*.035));
  last=Math.min(frames,last+Math.round(rate*.05));
  if(last-first>=frames-step)return wave;
  const header=Buffer.from(wave.subarray(0,dataStart));
  header.writeUInt32LE(header.length+(last-first)*2-8,4);
  header.writeUInt32LE((last-first)*2,dataStart-4);
  return Buffer.concat([header,wave.subarray(dataStart+first*2,dataStart+last*2)]);
}

async function synthesize(text,signal,profile,language) {
  if (profile==='feminine' || language==='en' || process.platform!=='win32' ||
    !(await fs.stat(voice).catch(()=>null))) return trimSentence(await require('./natural-voice.cjs')(text,signal,language,profile));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'kopbri-tts-'));
  const output = path.join(temp,'reply.wav');
  try {
    await new Promise((resolve,reject) => {
      const args = ['--model',voice,'--output_file',output];
      const child = execFile(path.join(runtime,'piper.exe'),args,{
        cwd:runtime,signal,windowsHide:true,timeout:25000,maxBuffer:1048576
      },error => error ? reject(error) : resolve());
      child.stdin.on('error',() => {});
      child.stdin.end(text+'\n','utf8');
    });
    return trimSentence(await fs.readFile(output));
  } finally {
    await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports = synthesize;
