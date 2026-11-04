class KopbriVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = () => {
      const tail = this.buffer.slice(0,this.offset);
      this.offset = 0;
      this.port.postMessage({tail},[tail.buffer]);
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.buffer[this.offset++] = sample;
      if (this.offset===this.buffer.length) {
        this.port.postMessage(this.buffer,[this.buffer.buffer]);
        this.buffer = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('kopbri-voice',KopbriVoiceCapture);
