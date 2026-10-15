"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClockTransport, MediaTransport, type Transport } from "../audio/transport";
import { Metronome } from "../audio/metronome";
import { getAudioContext, resumeAudio } from "../audio/engine";
import { YouTubeTransport } from "../media/youtube";
import type { BeatMap } from "../song/alignment";
import { getReady } from "./getReady";

export interface LoopRange {
  start: number;
  end: number;
  label: string;
}

export interface PlaybackOptions {
  /** Recording to play, or null for the app's own clock. */
  blob: Blob | null;
  /** Play along with a YouTube video instead (rendered into `container`). */
  youtube?: { videoId: string; container: HTMLElement | null } | null;
  /** Song-time length when running on the clock. */
  clockDuration: number;
  beatMap: BeatMap;
  beatsPerBar: number;
  /** Natural subdivisions per beat (3 in compound meters). */
  subdivisionsPerBeat: number;
  /** BPM at 100% speed (for count-in). */
  bpm: number;
  /** Checked when play is pressed: true runs the get-ready countdown first. */
  getReadyFirst?: () => boolean;
}

export interface UsePlayback {
  transport: Transport | null;
  ready: boolean;
  loadError: string | null;
  playing: boolean;
  countingIn: boolean;
  speed: number;
  setSpeed: (s: number) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  restart: () => void;
  getTime: () => number;
  duration: number;
  metronomeOn: boolean;
  setMetronomeOn: (v: boolean) => void;
  setMetronomeVolume: (v: number) => void;
  subdivide: boolean;
  setSubdivide: (v: boolean) => void;
  countIn: boolean;
  setCountIn: (v: boolean) => void;
  loop: LoopRange | null;
  setLoop: (l: LoopRange | null) => void;
  setVolume: (v: number) => void;
  pitchPreserved: boolean;
  isYouTube: boolean;
  /** Seconds of song time actually played (for session duration). */
  activeSeconds: () => number;
  onEnded: (fn: () => void) => void;
}

export function usePlayback(o: PlaybackOptions): UsePlayback {
  // Asked at the moment play is pressed: count down first (e.g. while listening).
  const getReadyFirst = useRef(o.getReadyFirst);
  useEffect(() => {
    getReadyFirst.current = o.getReadyFirst;
  });
  const [transport, setTransport] = useState<Transport | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [countingIn, setCountingIn] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [metronomeOn, setMetronomeOn] = useState(!o.blob);
  const [subdivide, setSubdivide] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const metro = useRef<Metronome | null>(null);
  const beatMapRef = useRef(o.beatMap);
  const loopRef = useRef<LoopRange | null>(null);
  const active = useRef({ total: 0, since: 0 });
  const endedCb = useRef<(() => void) | null>(null);
  const tRef = useRef<Transport | null>(null);

  useEffect(() => {
    beatMapRef.current = o.beatMap;
    metro.current?.resync();
  }, [o.beatMap]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  // Create the transport for the current source.
  const ytId = o.youtube?.videoId ?? null;
  const ytContainer = o.youtube?.container ?? null;
  useEffect(() => {
    let disposed = false;
    let t: Transport;
    if (ytId) {
      if (!ytContainer) return;
      const y = new YouTubeTransport(ytId, ytContainer);
      t = y;
      y.ready()
        .then(() => !disposed && setReady(true))
        .catch((e: Error) => !disposed && setLoadError(e.message));
    } else if (o.blob) {
      const m = new MediaTransport(o.blob);
      t = m;
      m.ready()
        .then(() => !disposed && setReady(true))
        .catch((e: Error) => !disposed && setLoadError(e.message));
    } else {
      t = new ClockTransport(o.clockDuration);
      // Ready on the next tick (keeps state updates out of the effect body).
      queueMicrotask(() => !disposed && setReady(true));
    }
    t.onEnded(() => {
      setPlaying(false);
      endedCb.current?.();
    });
    tRef.current = t;
    queueMicrotask(() => !disposed && setTransport(t));
    return () => {
      disposed = true;
      t.dispose();
      tRef.current = null;
      setReady(false);
      setPlaying(false);
    };
  }, [o.blob, o.clockDuration, ytId, ytContainer]);

  // Metronome follows the transport through the beat map.
  useEffect(() => {
    if (!transport) return;
    const m = new Metronome({
      now: () => ({ songTime: transport.getTime(), playing: transport.isPlaying(), rate: transport.getRate() }),
      beatToSong: (b) => beatMapRef.current.beatToTime(b),
      songToBeat: (t) => beatMapRef.current.timeToBeat(t),
      songToCtx: (t) => transport.songToCtxTime(t),
    });
    m.beatsPerBar = o.beatsPerBar;
    metro.current = m;
    m.start();
    return () => {
      m.dispose();
      metro.current = null;
    };
  }, [transport, o.beatsPerBar]);

  useEffect(() => {
    if (!metro.current) return;
    metro.current.enabled = metronomeOn;
    metro.current.subdivisions = subdivide ? o.subdivisionsPerBeat : 1;
    metro.current.resync();
  }, [metronomeOn, subdivide, o.subdivisionsPerBeat, transport]);

  // Loop enforcement and end-of-clock detection.
  useEffect(() => {
    if (!playing || !transport) return;
    const id = window.setInterval(() => {
      const l = loopRef.current;
      const t = transport.getTime();
      if (l && t >= l.end) {
        transport.seek(l.start);
        metro.current?.resync();
      }
      if (!transport.isPlaying()) setPlaying(false);
    }, 20);
    return () => window.clearInterval(id);
  }, [playing, transport]);

  const markStart = () => {
    active.current.since = performance.now();
  };
  const markStop = () => {
    if (active.current.since) active.current.total += (performance.now() - active.current.since) / 1000;
    active.current.since = 0;
  };

  const play = useCallback(async () => {
    const t = tRef.current;
    if (!t || t.isPlaying() || countingIn) return;
    await resumeAudio();
    if (getReadyFirst.current?.()) {
      setCountingIn(true);
      const go = await getReady();
      setCountingIn(false);
      if (!go) return;
    }
    if (loopRef.current) {
      const now = t.getTime();
      if (now < loopRef.current.start || now >= loopRef.current.end) t.seek(loopRef.current.start);
    }
    if (countIn && metro.current) {
      setCountingIn(true);
      const startAt = await metro.current.countIn(o.beatsPerBar, o.bpm * t.getRate(), 1);
      setCountingIn(false);
      if (t instanceof ClockTransport) {
        t.playAt(startAt);
      } else {
        await t.play();
      }
    } else {
      await t.play();
    }
    metro.current?.resync();
    markStart();
    setPlaying(true);
  }, [countIn, countingIn, o.beatsPerBar, o.bpm]);

  const pause = useCallback(() => {
    tRef.current?.pause();
    metro.current?.resync();
    markStop();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (tRef.current?.isPlaying()) pause();
    else void play();
  }, [pause, play]);

  const seek = useCallback((time: number) => {
    tRef.current?.seek(time);
    metro.current?.resync();
  }, []);

  const restart = useCallback(() => {
    seek(loopRef.current?.start ?? 0);
  }, [seek]);

  const setSpeed = useCallback((s: number) => {
    const v = Math.max(0.25, Math.min(1.5, s));
    tRef.current?.setRate(v);
    metro.current?.resync();
    // Players such as YouTube may round to a rate they support; show the real one.
    setSpeedState(tRef.current?.getRate() ?? v);
  }, []);

  const duration = useMemo(() => transport?.duration ?? o.clockDuration, [transport, o.clockDuration, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    transport,
    ready,
    loadError,
    playing,
    countingIn,
    speed,
    setSpeed,
    play,
    pause,
    toggle,
    seek,
    restart,
    getTime: () => tRef.current?.getTime() ?? 0,
    duration,
    metronomeOn,
    setMetronomeOn,
    setMetronomeVolume: (v) => metro.current?.setVolume(v),
    subdivide,
    setSubdivide,
    countIn,
    setCountIn,
    loop,
    setLoop,
    setVolume: (v) => tRef.current?.setVolume(v),
    pitchPreserved: transport instanceof MediaTransport ? transport.pitchPreserved : true,
    isYouTube: transport instanceof YouTubeTransport,
    activeSeconds: () => active.current.total + (active.current.since ? (performance.now() - active.current.since) / 1000 : 0),
    onEnded: (fn) => {
      endedCb.current = fn;
    },
  };
}

export function ctxNow(): number {
  return getAudioContext().currentTime;
}
