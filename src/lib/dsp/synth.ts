/**
 * Karplus–Strong plucked-string synthesis, used to generate guitar-like test
 * signals (strummed chords with harmonics, decay and string-to-string delay).
 * These are synthetic signals: good for repeatable tests, not a substitute for
 * a real guitar through a real microphone.
 */

import { STANDARD_TUNING_MIDI, type Frets } from "../music/shapes";

export function midiToHz(m: number, a4 = 440): number {
  return a4 * Math.pow(2, (m - 69) / 12);
}

/** Simple deterministic PRNG so synthetic fixtures are reproducible. */
export function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pluck(out: Float32Array, sr: number, startSample: number, freq: number, opts: { amp?: number; decay?: number; brightness?: number; random?: () => number; maxSec?: number } = {}): void {
  const random = opts.random ?? Math.random;
  const amp = opts.amp ?? 0.3;
  const rho = opts.decay ?? 0.996;
  const bright = opts.brightness ?? 0.6;
  // y[n] = (y[n-L] + y[n-L+1]) / 2, so the loop period is L - 0.5 samples.
  const L = Math.max(2, Math.round(sr / freq + 0.5));
  const buf = new Float32Array(L);
  let lp = 0;
  for (let i = 0; i < L; i++) {
    lp += bright * (random() * 2 - 1 - lp);
    buf[i] = lp * amp;
  }
  const len = Math.min(out.length - startSample, Math.floor(sr * (opts.maxSec ?? 4)));
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    const nxt = buf[idx + 1 === L ? 0 : idx + 1];
    out[startSample + i] += cur;
    buf[idx] = rho * 0.5 * (cur + nxt);
    idx = idx + 1 === L ? 0 : idx + 1;
  }
}

export interface StrumOptions {
  capo?: number;
  direction?: "down" | "up";
  spreadMs?: number;
  amp?: number;
  a4?: number;
  seed?: number;
  maxSec?: number;
}

/** Strums a chord shape into `out` at `time` seconds. */
export function strum(out: Float32Array, sr: number, time: number, frets: Frets, opts: StrumOptions = {}): void {
  const random = rng(opts.seed ?? Math.floor(time * 1000) + 7);
  const order = frets.map((f, i) => ({ f, i })).filter((s) => s.f !== null);
  if (opts.direction === "up") order.reverse();
  const spread = (opts.spreadMs ?? 12) / 1000;
  order.forEach((s, k) => {
    const midi = STANDARD_TUNING_MIDI[s.i] + (opts.capo ?? 0) + (s.f as number);
    const start = Math.round((time + k * spread) * sr);
    if (start >= out.length) return;
    pluck(out, sr, start, midiToHz(midi, opts.a4), {
      amp: (opts.amp ?? 0.25) * (1 - s.i * 0.06),
      random,
      decay: 0.9965,
      maxSec: opts.maxSec,
    });
  });
}

export function addNoise(out: Float32Array, level: number, seed = 3): void {
  const r = rng(seed);
  for (let i = 0; i < out.length; i++) out[i] += (r() * 2 - 1) * level;
}

export function normalise(out: Float32Array, peak = 0.8): void {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  if (m > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / m;
}

export function sine(sr: number, freq: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(sr * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** 16-bit PCM WAV encoder (mono). */
export function encodeWav(samples: Float32Array, sr: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}
