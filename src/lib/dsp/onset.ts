/**
 * Streaming onset (strum/attack) detection using log-compressed spectral flux
 * with a frequency max-filter on the previous frame (reduces false triggers
 * from vibrato and ringing strings) and adaptive peak picking.
 */

import { magnitudeSpectrum, rms, toDb } from "./fft";

export interface Onset {
  /** Seconds, on the same clock as the samples fed in. */
  time: number;
  /** Relative strength (flux above the local threshold). */
  strength: number;
}

export interface OnsetOptions {
  sampleRate: number;
  frameSize?: number;
  hop?: number;
  /** Minimum gap between onsets, seconds. */
  minGap?: number;
  /** Frames quieter than this (dBFS) never produce onsets. */
  gateDb?: number;
  sensitivity?: number;
}

export class OnsetDetector {
  readonly sr: number;
  readonly n: number;
  readonly hop: number;
  private minGapFrames: number;
  private gateDb: number;
  private sensitivity: number;
  private buffer: Float32Array;
  private filled = 0;
  private samplesSeen = 0;
  private startTime = 0;
  private prevLog: Float64Array | null = null;
  private flux: number[] = [];
  private frameTimes: number[] = [];
  private frameDb: number[] = [];
  private lastOnsetFrame = -1e9;
  private frameIndex = 0;
  private kMin: number;
  private kMax: number;
  private runningMax = 1e-6;

  constructor(opts: OnsetOptions) {
    this.sr = opts.sampleRate;
    this.n = opts.frameSize ?? (this.sr > 32000 ? 1024 : 512);
    this.hop = opts.hop ?? this.n / 2;
    this.minGapFrames = Math.round(((opts.minGap ?? 0.06) * this.sr) / this.hop);
    this.gateDb = opts.gateDb ?? -55;
    this.sensitivity = opts.sensitivity ?? 1;
    this.buffer = new Float32Array(this.n);
    this.kMin = Math.max(1, Math.floor((40 * this.n) / this.sr));
    this.kMax = Math.min(this.n / 2, Math.ceil((9000 * this.n) / this.sr));
  }

  /** Sets the clock time of the first sample that will be pushed next. */
  setTime(t: number): void {
    this.startTime = t - this.samplesSeen / this.sr;
  }

  /** Feeds samples; returns any onsets confirmed so far. */
  push(samples: ArrayLike<number>): Onset[] {
    const found: Onset[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(this.n - this.filled, samples.length - i);
      for (let k = 0; k < take; k++) this.buffer[this.filled + k] = samples[i + k];
      this.filled += take;
      i += take;
      if (this.filled === this.n) {
        const o = this.processFrame();
        if (o) found.push(o);
        this.buffer.copyWithin(0, this.hop);
        this.filled = this.n - this.hop;
      }
    }
    this.samplesSeen += samples.length;
    return found;
  }

  private processFrame(): Onset | null {
    // Time of this frame: its start plus a quarter frame (the attack typically lands early in the window).
    const frameStartSample = this.samplesSeen + 0 - (this.filled - this.n); // approximate; refined below
    void frameStartSample;
    const frameTime = this.startTime + (this.frameIndex * this.hop + this.n * 0.25) / this.sr;
    const mag = magnitudeSpectrum(this.buffer, this.n);
    const logMag = new Float64Array(mag.length);
    for (let k = 0; k < mag.length; k++) logMag[k] = Math.log1p(100 * mag[k]);
    let f = 0;
    if (this.prevLog) {
      for (let k = this.kMin; k <= this.kMax; k++) {
        const ref = Math.max(this.prevLog[k - 1], this.prevLog[k], this.prevLog[k + 1] ?? 0);
        const d = logMag[k] - ref;
        if (d > 0) f += d;
      }
    }
    this.prevLog = logMag;
    this.flux.push(f);
    this.frameTimes.push(frameTime);
    this.frameDb.push(toDb(rms(this.buffer)));
    this.frameIndex++;
    this.runningMax = Math.max(this.runningMax * 0.999, f);

    const pre = 3;
    const post = 2;
    const avgPre = 10;
    const c = this.flux.length - 1 - post;
    if (c < avgPre) return null;
    const v = this.flux[c];
    for (let j = c - pre; j <= c + post; j++) if (j !== c && this.flux[j] > v) return this.trim(null);
    let mean = 0;
    for (let j = c - avgPre; j < c; j++) mean += this.flux[j];
    mean /= avgPre;
    const delta = Math.max(0.12 * this.runningMax, 2) / this.sensitivity;
    const absoluteIndex = this.frameIndex - 1 - post;
    const loud = Math.max(this.frameDb[c], this.frameDb[c + 1] ?? -200) > this.gateDb;
    if (v >= mean + delta && loud && absoluteIndex - this.lastOnsetFrame >= this.minGapFrames) {
      this.lastOnsetFrame = absoluteIndex;
      return this.trim({ time: this.frameTimes[c], strength: (v - mean) / Math.max(this.runningMax, 1e-6) });
    }
    return this.trim(null);
  }

  private trim(o: Onset | null): Onset | null {
    if (this.flux.length > 64) {
      const cut = this.flux.length - 32;
      this.flux.splice(0, cut);
      this.frameTimes.splice(0, cut);
      this.frameDb.splice(0, cut);
    }
    return o;
  }
}

/** Offline helper: all onsets in a buffer. */
export function detectOnsets(samples: Float32Array, sampleRate: number, opts: Partial<OnsetOptions> = {}): Onset[] {
  const d = new OnsetDetector({ sampleRate, ...opts });
  return d.push(samples);
}
