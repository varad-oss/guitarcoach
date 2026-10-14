"use client";

/**
 * Play-along with a YouTube video through YouTube's official embedded player
 * (IFrame Player API, privacy-enhanced youtube-nocookie.com host). The audio is
 * never downloaded or analysed; the player is only driven (play, pause, seek,
 * speed) and its clock is followed.
 */

import { ctxToPerf, getAudioContext } from "../audio/engine";
import type { Transport } from "../audio/transport";

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (ID_RE.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

/** Minimal typing of the parts of the IFrame API that are used. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setVolume(v: number): void;
  getVideoData?(): { title?: string; author?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      host?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(timeoutMs = 15000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      apiPromise = null;
      reject(new Error("YouTube's player couldn't be loaded. It needs an internet connection."));
    }, timeoutMs);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      window.clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      window.clearTimeout(timer);
      apiPromise = null;
      reject(new Error("YouTube's player couldn't be loaded. It needs an internet connection."));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const ERRORS: Record<number, string> = {
  2: "That YouTube link isn't valid.",
  5: "This video can't be played in an embedded player.",
  100: "That video was removed or made private.",
  101: "The video's owner doesn't allow it to be played outside YouTube.",
  150: "The video's owner doesn't allow it to be played outside YouTube.",
};

export class YouTubeTransport implements Transport {
  readonly kind = "media";
  readonly pitchPreserved = true;
  /** Set only once YouTube reports the player ready: before that its methods don't exist yet. */
  private player: YTPlayer | null = null;
  private pending: YTPlayer | null = null;
  private readyPromise: Promise<void>;
  private rate = 1;
  private anchorPerf = 0;
  private anchorMedia = 0;
  private playing = false;
  private endCb: (() => void) | null = null;
  private mount: HTMLDivElement;
  title = "";

  constructor(
    readonly videoId: string,
    container: HTMLElement,
  ) {
    // The API replaces the element it is given, so give it a child we own.
    this.mount = document.createElement("div");
    container.appendChild(this.mount);
    this.readyPromise = loadYouTubeApi().then(
      (YT) =>
        new Promise<void>((resolve, reject) => {
          this.pending = new YT.Player(this.mount, {
            videoId,
            host: "https://www.youtube-nocookie.com",
            width: "100%",
            height: "100%",
            playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, origin: window.location.origin },
            events: {
              onReady: (e) => {
                this.player = e.target;
                this.title = e.target.getVideoData?.()?.title ?? "";
                if (this.rate !== 1) this.setRate(this.rate);
                if (this.volume !== null) this.setVolume(this.volume);
                resolve();
              },
              onStateChange: (e) => {
                // 1 playing, 2 paused, 0 ended, 3 buffering
                if (e.data === 1) {
                  this.playing = true;
                  this.reanchor();
                } else if (e.data === 2) {
                  this.playing = false;
                  this.reanchor();
                } else if (e.data === 0) {
                  this.playing = false;
                  this.endCb?.();
                } else if (e.data === 3) this.reanchor();
              },
              onError: (e) => reject(new Error(ERRORS[e.data] ?? "The video couldn't be played.")),
            },
          });
        }),
    );
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  get duration(): number | null {
    const d = this.player?.getDuration() ?? 0;
    return d > 0 ? d : null;
  }

  private reanchor(): void {
    if (!this.player) return;
    this.anchorPerf = performance.now();
    this.anchorMedia = this.player.getCurrentTime();
  }

  async play(): Promise<void> {
    await this.readyPromise;
    await getAudioContext().resume();
    this.player!.playVideo();
    this.playing = true;
    this.reanchor();
  }
  pause(): void {
    this.player?.pauseVideo();
    this.playing = false;
    this.reanchor();
  }
  seek(t: number): void {
    this.player?.seekTo(Math.max(0, t), true);
    this.anchorPerf = performance.now();
    this.anchorMedia = Math.max(0, t);
  }
  getTime(): number {
    if (!this.player) return 0;
    if (!this.playing) return this.player.getCurrentTime();
    const predicted = this.anchorMedia + ((performance.now() - this.anchorPerf) / 1000) * this.rate;
    const actual = this.player.getCurrentTime();
    // The player's clock updates in steps; follow it smoothly, but resync on real drift (buffering, seeks).
    if (Math.abs(predicted - actual) > 0.25) {
      this.anchorPerf = performance.now();
      this.anchorMedia = actual;
      return actual;
    }
    return predicted;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  setRate(r: number): void {
    if (!this.player) {
      this.rate = r;
      return;
    }
    this.player.setPlaybackRate(r);
    // YouTube may round to a rate it supports; follow what it actually uses.
    this.rate = this.player.getPlaybackRate() || r;
    this.reanchor();
  }
  getRate(): number {
    return this.rate;
  }
  /** Rates YouTube offers for this video (e.g. 0.25 … 2). */
  availableRates(): number[] {
    return this.player?.getAvailablePlaybackRates() ?? [];
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
  private volume: number | null = null;
  setVolume(v: number): void {
    this.volume = v;
    this.player?.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100));
  }
  onEnded(cb: () => void): void {
    this.endCb = cb;
  }
  dispose(): void {
    try {
      (this.player ?? this.pending)?.destroy?.();
    } catch {
      /* already gone */
    }
    this.mount.remove();
    this.player = null;
    this.pending = null;
  }
}
