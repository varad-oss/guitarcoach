"use client";

/**
 * Transports report "song time" in seconds at 100% speed:
 * - ClockTransport: the app's own clock (no recording). The song timeline is
 *   defined by the target tempo, so it is exact by construction.
 * - MediaTransport: a user-supplied recording played through an <audio>
 *   element, which time-stretches without changing pitch (preservesPitch).
 * Both map between the audio clock and song time so microphone events and
 * metronome clicks line up with the music.
 */

import { ctxToPerf, getAudioContext } from "./engine";

export interface Transport {
  readonly kind: "clock" | "media";
  readonly duration: number | null;
  play(): Promise<void>;
  pause(): void;
  seek(t: number): void;
  getTime(): number;
  isPlaying(): boolean;
  setRate(r: number): void;
  getRate(): number;
  /** Song time at a given audio-clock time (only meaningful while playing). */
  ctxToSongTime(ctxTime: number): number;
  /** Audio-clock time at which a song time will sound (while playing). */
  songToCtxTime(songTime: number): number;
  setVolume(v: number): void;
  onEnded(cb: () => void): void;
  dispose(): void;
}

export class ClockTransport implements Transport {
  readonly kind = "clock";
  private playing = false;
  private songAtStart = 0;
  private ctxAtStart = 0;
  private rate = 1;
  private endCb: (() => void) | null = null;
  constructor(public duration: number | null) {}

  async play(): Promise<void> {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.ctxAtStart = ctx.currentTime;
    this.playing = true;
  }
  /** Starts exactly at an audio-clock time (after a count-in). */
  playAt(ctxTime: number): void {
    this.ctxAtStart = ctxTime;
    this.playing = true;
  }
  pause(): void {
    if (!this.playing) return;
    this.songAtStart = this.getTime();
    this.playing = false;
  }
  seek(t: number): void {
    const ctx = getAudioContext();
    this.songAtStart = Math.max(0, t);
    this.ctxAtStart = ctx.currentTime;
  }
  getTime(): number {
    if (!this.playing) return this.songAtStart;
    const t = this.songAtStart + Math.max(0, getAudioContext().currentTime - this.ctxAtStart) * this.rate;
    if (this.duration !== null && t >= this.duration) {
      this.songAtStart = this.duration;
      this.playing = false;
      this.endCb?.();
      return this.duration;
    }
    return t;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  setRate(r: number): void {
    if (this.playing) {
      this.songAtStart = this.getTime();
      this.ctxAtStart = getAudioContext().currentTime;
    }
    this.rate = r;
  }
  getRate(): number {
    return this.rate;
  }
  ctxToSongTime(ctxTime: number): number {
    if (!this.playing) return this.songAtStart;
    return this.songAtStart + (ctxTime - this.ctxAtStart) * this.rate;
  }
  songToCtxTime(songTime: number): number {
    return this.ctxAtStart + (songTime - this.songAtStart) / this.rate;
  }
  setVolume(): void {}
  onEnded(cb: () => void): void {
    this.endCb = cb;
  }
  dispose(): void {
    this.playing = false;
  }
}

export class MediaTransport implements Transport {
  readonly kind = "media";
  readonly el: HTMLAudioElement;
  private url: string;
  private rate = 1;
  private anchorPerf = 0;
  private anchorMedia = 0;
  private lastSeen = -1;
  private endCb: (() => void) | null = null;
  readonly pitchPreserved: boolean;

  constructor(blob: Blob) {
    this.url = URL.createObjectURL(blob);
    this.el = new Audio();
    this.el.preload = "auto";
    this.el.src = this.url;
    // Browsers time-stretch <audio> without changing pitch when preservesPitch is set.
    const el = this.el as unknown as Record<string, unknown>;
    if ("preservesPitch" in el) {
      el.preservesPitch = true;
      this.pitchPreserved = true;
    } else if ("webkitPreservesPitch" in el) {
      el.webkitPreservesPitch = true;
      this.pitchPreserved = true;
    } else this.pitchPreserved = false;
    this.el.addEventListener("ended", () => this.endCb?.());
    this.el.addEventListener("seeked", () => this.reanchor());
    this.el.addEventListener("playing", () => this.reanchor());
  }

  get duration(): number | null {
    return Number.isFinite(this.el.duration) ? this.el.duration : null;
  }

  ready(): Promise<void> {
    if (this.el.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.el.addEventListener("loadedmetadata", () => resolve(), { once: true });
      this.el.addEventListener("error", () => reject(new Error("This audio file can't be played in this browser.")), { once: true });
    });
  }

  private reanchor(): void {
    this.anchorPerf = performance.now();
    this.anchorMedia = this.el.currentTime;
    this.lastSeen = this.el.currentTime;
  }

  async play(): Promise<void> {
    await getAudioContext().resume();
    await this.el.play();
    this.reanchor();
  }
  pause(): void {
    this.el.pause();
    this.reanchor();
  }
  seek(t: number): void {
    this.el.currentTime = Math.max(0, Math.min(t, (this.duration ?? t + 1) - 0.01));
    this.reanchor();
  }
  getTime(): number {
    if (this.el.paused) return this.el.currentTime;
    // currentTime updates in coarse steps; interpolate between updates for smooth display.
    const ct = this.el.currentTime;
    if (ct !== this.lastSeen) {
      const predicted = this.anchorMedia + ((performance.now() - this.anchorPerf) / 1000) * this.rate;
      if (Math.abs(predicted - ct) > 0.05) this.reanchor();
      this.lastSeen = ct;
    }
    return this.anchorMedia + ((performance.now() - this.anchorPerf) / 1000) * this.rate;
  }
  isPlaying(): boolean {
    return !this.el.paused && !this.el.ended;
  }
  setRate(r: number): void {
    this.rate = r;
    this.el.playbackRate = r;
    this.reanchor();
  }
  getRate(): number {
    return this.rate;
  }
  ctxToSongTime(ctxTime: number): number {
    const perf = ctxToPerf(getAudioContext(), ctxTime);
    return this.anchorMedia + ((perf - this.anchorPerf) / 1000) * this.rate;
  }
  songToCtxTime(songTime: number): number {
    const ctx = getAudioContext();
    const perf = this.anchorPerf + ((songTime - this.anchorMedia) / this.rate) * 1000;
    return ctx.currentTime + (perf - performance.now()) / 1000;
  }
  setVolume(v: number): void {
    this.el.volume = Math.max(0, Math.min(1, v));
  }
  onEnded(cb: () => void): void {
    this.endCb = cb;
  }
  dispose(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    URL.revokeObjectURL(this.url);
  }
}
