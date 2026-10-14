"use client";

/** One shared AudioContext for playback, metronome and microphone analysis. */

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext({ latencyHint: "interactive" });
  }
  return ctx;
}

/** Must be called from a user gesture before audio can start in most browsers. */
export async function resumeAudio(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state === "suspended") await c.resume();
  return c;
}

/** Converts an audio-clock time to performance.now() milliseconds. */
export function ctxToPerf(c: AudioContext, ctxTime: number): number {
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
    return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
  }
  return performance.now() + (ctxTime - c.currentTime) * 1000;
}

export function perfToCtx(c: AudioContext, perfMs: number): number {
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
    return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  }
  return c.currentTime + (perfMs - performance.now()) / 1000;
}

/** Output latency estimate (speaker side), seconds. */
export function outputLatency(c: AudioContext): number {
  return (c.outputLatency || 0) + (c.baseLatency || 0);
}
