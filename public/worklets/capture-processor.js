// Captures microphone audio in fixed-size chunks and forwards them (with the
// audio-clock frame of the first sample) to the analysis worker. Runs on the
// audio rendering thread; does no analysis itself.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.startFrame = 0;
    this.out = null;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "port") this.out = e.data.port;
    };
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      if (this.n === 0) this.startFrame = currentFrame + i;
      const take = Math.min(ch.length - i, this.size - this.n);
      this.buf.set(ch.subarray(i, i + take), this.n);
      this.n += take;
      i += take;
      if (this.n === this.size) {
        const target = this.out || this.port;
        target.postMessage({ type: "audio", samples: this.buf, frame: this.startFrame }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("gc-capture", CaptureProcessor);
