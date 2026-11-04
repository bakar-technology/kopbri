'use strict';
const path=require('node:path');
const {OfflineRecognizer}=require('sherpa-onnx-node');
let recognizer;
function warm() {
  if(recognizer)return recognizer;
  const model=file=>path.join(process.env.KOPBRI_ASR_MODELS,file);
  recognizer=new OfflineRecognizer({
    featConfig:{sampleRate:16000,featureDim:80},
    modelConfig:{transducer:{encoder:model('encoder.int8.onnx'),decoder:model('decoder.int8.onnx'),joiner:model('joiner.int8.onnx')},
      tokens:model('tokens.txt'),modelType:'nemo_transducer',numThreads:2,debug:false,provider:'cpu'},
    decodingMethod:'greedy_search'
  });
  return recognizer;
}
function decode(pcm) {
  if(pcm.length<8000)return '';
  const samples=new Float32Array(pcm.length/2);
  let power=0;
  for(let i=0;i<samples.length;i++) {
    const sample=pcm.readInt16LE(i*2)/32768;
    samples[i]=sample*8;
    power+=sample*sample;
  }
  if(power/samples.length<.000004)return '';
  const model=warm(),stream=model.createStream();
  stream.acceptWaveform({samples,sampleRate:16000});
  model.decode(stream);
  return String(model.getResult(stream).text||'').trim();
}
process.on('message',({id,action,pcm})=>{
  try { process.send({id,result:action==='warm'?Boolean(warm()):decode(pcm)}); }
  catch(error){process.send({id,error:error.message});}
});
process.on('disconnect',()=>process.exit());
