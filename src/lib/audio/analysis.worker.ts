/// <reference lib="webworker" />
/**
 * Real-time analysis worker. Receives microphone chunks straight from the
 * capture AudioWorklet and runs FFT/chroma, onset detection and (in tuner
 * mode) YIN — keeping all DSP off the UI thread.
 */

import { magnitudeSpectrum, rms, toDb } from "../dsp/fft";
import { chromaFromSpectrum, isTonal } from "../dsp/chroma";
import { OnsetDetector } from "../dsp/onset";
import { yin } from "../dsp/pitch";
import type { AnalysisMode, FromWorker, ToWorker } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let sr = 48000;
let mode: AnalysisMode = "chords";
let a4 = 440;
let N = 8192;
let HOP = 2048;
const PITCH_N = 4096;
let ring = new Float32Array(N);
let ringFill = 0;
let sinceFrame = 0;
let sincePitch = 0;
let lastTime = 0;
let onset: OnsetDetector | null = null;
let onsetStarted = false;

function post(m: FromWorker) {
  ctx.postMessage(m);
}

function reset() {
  N = sr >= 32000 ? 8192 : 4096;
  HOP = N / 4;
  ring = new Float32Array(N);
  ringFill = 0;
  sinceFrame = 0;
  sincePitch = 0;
  onset = new OnsetDetector({ sampleRate: sr });
  onsetStarted = false;
}

function handleAudio(samples: Float32Array, frame: number) {
  const t0 = frame / sr;
  if (onset && !onsetStarted) {
    onset.setTime(t0);
    onsetStarted = true;
  }
  if (mode === "chords" && onset) {
    for (const o of onset.push(samples)) post({ type: "onset", time: o.time, strength: o.strength });
  }
  // Append to ring buffer (keep the last N samples).
  if (samples.length >= N) {
    ring.set(samples.subarray(samples.length - N));
    ringFill = N;
  } else {
    ring.copyWithin(0, samples.length);
    ring.set(samples, N - samples.length);
    ringFill = Math.min(N, ringFill + samples.length);
  }
  lastTime = t0 + samples.length / sr;
  sinceFrame += samples.length;
  sincePitch += samples.length;

  if (mode === "chords" && sinceFrame >= HOP && ringFill === N) {
    sinceFrame = 0;
    const mag = magnitudeSpectrum(ring, N);
    const c = chromaFromSpectrum(mag, { sampleRate: sr, fftSize: N, a4 });
    const level = toDb(rms(ring.subarray(N - HOP)));
    post({
      type: "frame",
      time: lastTime - N / sr / 2,
      rmsDb: level,
      tonal: isTonal(c),
      tonalRatio: c.tonalRatio,
      chroma: Array.from(c.chroma),
      bassPc: c.bassPc,
    });
  }
  if (mode === "tuner" && sincePitch >= 1024 && ringFill >= PITCH_N) {
    sincePitch = 0;
    const frameData = ring.subarray(N - PITCH_N);
    const level = toDb(rms(frameData));
    const p = level > -60 ? yin(frameData, sr, { minHz: 60, maxHz: 1100 }) : null;
    post({ type: "pitch", time: lastTime, freq: p?.freq ?? null, confidence: p?.confidence ?? 0, rmsDb: level });
  }
}

function onMessage(m: ToWorker) {
  switch (m.type) {
    case "init":
      sr = m.sampleRate;
      mode = m.mode;
      a4 = m.a4;
      reset();
      if (m.port) m.port.onmessage = (e: MessageEvent) => onMessage(e.data as ToWorker);
      post({ type: "ready" });
      break;
    case "mode":
      mode = m.mode;
      onset = new OnsetDetector({ sampleRate: sr });
      onsetStarted = false;
      break;
    case "a4":
      a4 = m.a4;
      break;
    case "audio":
      handleAudio(m.samples, m.frame);
      break;
  }
}

ctx.onmessage = (e: MessageEvent) => onMessage(e.data as ToWorker);
