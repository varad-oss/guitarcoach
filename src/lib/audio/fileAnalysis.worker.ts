/// <reference lib="webworker" />
import { analyseRecording } from "../dsp/fileAnalysis";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number; beatsPerBar: number; targetBpm: number | null; a4: number }>) => {
  const { samples, sampleRate, beatsPerBar, targetBpm, a4 } = e.data;
  try {
    const result = analyseRecording(samples, sampleRate, {
      beatsPerBar,
      targetBpm,
      a4,
      onProgress: (p) => ctx.postMessage({ type: "progress", p }),
    });
    ctx.postMessage({ type: "done", result });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
