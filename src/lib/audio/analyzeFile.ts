"use client";

import type { FileAnalysis } from "../dsp/fileAnalysis";

export const ANALYSIS_SR = 22050;

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/** Decodes any browser-supported audio file to mono at 22.05 kHz (for analysis only). */
export async function decodeForAnalysis(blob: Blob): Promise<DecodedAudio> {
  const data = await blob.arrayBuffer();
  const tmp = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await tmp.decodeAudioData(data);
  } catch {
    throw new Error("This audio file couldn't be decoded. Try MP3, WAV, M4A/AAC, OGG or FLAC.");
  } finally {
    void tmp.close();
  }
  const length = Math.ceil(decoded.duration * ANALYSIS_SR);
  const off = new OfflineAudioContext(1, length, ANALYSIS_SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: ANALYSIS_SR, duration: decoded.duration };
}

/** Probes duration without full analysis. */
export async function audioDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const el = new Audio();
    el.preload = "metadata";
    el.src = url;
    return await new Promise<number>((resolve, reject) => {
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => reject(new Error("This audio file can't be played in this browser."));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function analyseInWorker(
  audio: DecodedAudio,
  opts: { beatsPerBar: number; targetBpm: number | null; a4: number },
  onProgress?: (p: number) => void,
): Promise<FileAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./fileAnalysis.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ type: string; p?: number; result?: FileAnalysis; message?: string }>) => {
      if (e.data.type === "progress") onProgress?.(e.data.p ?? 0);
      else if (e.data.type === "done") {
        worker.terminate();
        resolve(e.data.result!);
      } else if (e.data.type === "error") {
        worker.terminate();
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Analysis failed."));
    };
    const copy = audio.samples.slice();
    worker.postMessage({ samples: copy, sampleRate: audio.sampleRate, ...opts }, [copy.buffer]);
  });
}
