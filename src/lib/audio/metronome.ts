"use client";

/**
 * Sample-accurate metronome. Clicks are scheduled on the audio clock a little
 * ahead of time (lookahead scheduling), so timing does not depend on rendering
 * or timers. It can follow a transport (song time) or run on its own.
 */

import { getAudioContext } from "./engine";

type ClickKind = "accent" | "beat" | "sub";

const buffers = new Map<string, AudioBuffer>();

function clickBuffer(ctx: AudioContext, kind: ClickKind): AudioBuffer {
  const key = `${ctx.sampleRate}:${kind}`;
  const cached = buffers.get(key);
  if (cached) return cached;
  const dur = 0.05;
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  const freq = kind === "accent" ? 1760 : kind === "beat" ? 1175 : 880;
  const amp = kind === "sub" ? 0.35 : kind === "accent" ? 1 : 0.75;
  for (let i = 0; i < d.length; i++) {
    const t = i / ctx.sampleRate;
    d[i] = amp * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 90) * Math.min(1, i / 24);
  }
  buffers.set(key, buf);
  return buf;
}

export interface ScheduledClick {
  ctxTime: number;
  beat: number;
  kind: ClickKind;
}

export interface MetronomeSource {
  /** Current song time and whether the music is running. */
  now(): { songTime: number; playing: boolean; rate: number };
  /** Song time of a (fractional) beat position. */
  beatToSong(beat: number): number;
  songToBeat(t: number): number;
  songToCtx(songTime: number): number;
}

export class Metronome {
  private timer: number | null = null;
  private gain: GainNode;
  private nextSub = Number.NaN;
  private scheduled: AudioBufferSourceNode[] = [];
  /** Clicks scheduled recently, so other code (e.g. latency calibration) can reference them. */
  readonly history: ScheduledClick[] = [];
  enabled = true;
  subdivisions = 1;
  beatsPerBar = 4;
  accent = true;
  lookahead = 0.12;

  constructor(private source: MetronomeSource | null = null) {
    const ctx = getAudioContext();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.7;
    this.gain.connect(ctx.destination);
  }

  setSource(s: MetronomeSource | null): void {
    this.source = s;
    this.resync();
  }

  setVolume(v: number): void {
    this.gain.gain.value = Math.max(0, Math.min(1.5, v));
  }

  /** Forget scheduling position (after seeks, rate or tempo changes). */
  resync(): void {
    this.cancelPending();
    this.nextSub = Number.NaN;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.resync();
  }

  private cancelPending(): void {
    const ctx = getAudioContext();
    for (const s of this.scheduled) {
      try {
        if ((s as AudioBufferSourceNode & { _t?: number })._t! > ctx.currentTime) s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
  }

  private play(kind: ClickKind, at: number, beat: number): void {
    const ctx = getAudioContext();
    const src = ctx.createBufferSource() as AudioBufferSourceNode & { _t?: number };
    src.buffer = clickBuffer(ctx, kind);
    src.connect(this.gain);
    src.start(Math.max(at, ctx.currentTime));
    src._t = at;
    src.onended = () => {
      this.scheduled = this.scheduled.filter((x) => x !== src);
    };
    this.scheduled.push(src);
    this.history.push({ ctxTime: at, beat, kind });
    if (this.history.length > 256) this.history.splice(0, this.history.length - 256);
  }

  private tick(): void {
    const s = this.source;
    if (!s || !this.enabled) return;
    const { songTime, playing, rate } = s.now();
    if (!playing) {
      this.nextSub = Number.NaN;
      return;
    }
    const ctx = getAudioContext();
    const horizonSong = songTime + this.lookahead * rate;
    const subs = Math.max(1, this.subdivisions);
    if (Number.isNaN(this.nextSub)) {
      this.nextSub = Math.ceil(s.songToBeat(songTime) * subs - 1e-6);
    }
    for (let guard = 0; guard < 64; guard++) {
      const beat = this.nextSub / subs;
      const t = s.beatToSong(beat);
      if (t > horizonSong) break;
      this.nextSub++;
      if (beat < 0) continue;
      const at = s.songToCtx(t);
      if (at < ctx.currentTime - 0.01) continue;
      const isBeat = Math.abs(beat - Math.round(beat)) < 1e-6;
      const kind: ClickKind = !isBeat ? "sub" : this.accent && Math.round(beat) % this.beatsPerBar === 0 ? "accent" : "beat";
      this.play(kind, at, beat);
    }
  }

  /**
   * Plays a count-in of `beats` clicks at `bpm` (already scaled for practice
   * speed) and resolves with the audio-clock time the music should start.
   */
  countIn(beats: number, bpm: number, subdivisions = 1): Promise<number> {
    const ctx = getAudioContext();
    const spb = 60 / bpm;
    const start = ctx.currentTime + 0.12;
    for (let b = 0; b < beats; b++) {
      for (let k = 0; k < subdivisions; k++) {
        const at = start + b * spb + (k * spb) / subdivisions;
        this.play(k > 0 ? "sub" : b === 0 ? "accent" : "beat", at, b - beats + k / subdivisions);
      }
    }
    const end = start + beats * spb;
    return new Promise((resolve) => {
      const wait = () => {
        if (ctx.currentTime >= end - 0.03) resolve(end);
        else window.setTimeout(wait, 10);
      };
      wait();
    });
  }

  dispose(): void {
    this.stop();
    try {
      this.gain.disconnect();
    } catch {
      /* ignore */
    }
  }
}
