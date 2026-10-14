"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicInput, describeMicError, micSupported, type MicStatus } from "../audio/mic";
import { getAudioContext, outputLatency } from "../audio/engine";
import type { AnalysisMode, FromWorker, FrameMsg, PitchMsg } from "../audio/protocol";
import { ChordTracker, type LiveDetection } from "../coach/chordTracker";

export interface MicEvidence {
  /** Analysis frames with audio-clock time already corrected for latency. */
  frames: Array<FrameMsg & { soundTime: number }>;
  /** Onset sound times (audio clock, latency corrected). */
  onsets: number[];
}

export interface UseMic {
  status: MicStatus;
  error: string | null;
  level: number;
  detection: LiveDetection | null;
  pitch: PitchMsg | null;
  /** Total latency used for compensation, seconds, and whether it was measured. */
  latency: { seconds: number; measured: boolean };
  deviceLabel: string;
  start: () => Promise<void>;
  stop: () => void;
  evidence: React.RefObject<MicEvidence>;
  /** Subscribe to every onset (sound time). */
  onOnset: (fn: (soundTime: number, strength: number) => void) => () => void;
  onFrame: (fn: (f: FrameMsg & { soundTime: number }) => void) => () => void;
  /** Quality of signal so far: share of frames that were audible and pitched. */
  signalQuality: () => number | null;
}

export function useMic(opts: { mode: AnalysisMode; a4: number; deviceId?: string; latencyMs: number | null; capo?: number }): UseMic {
  const [status, setStatus] = useState<MicStatus>(() => (typeof window !== "undefined" && !micSupported() ? "unsupported" : "off"));
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(-100);
  const [detection, setDetection] = useState<LiveDetection | null>(null);
  const [pitch, setPitch] = useState<PitchMsg | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  // Estimated from the browser's reported latencies until the user calibrates.
  const [estimatedLatency, setEstimatedLatency] = useState(0);
  const latency = opts.latencyMs !== null ? { seconds: opts.latencyMs / 1000, measured: true } : { seconds: estimatedLatency, measured: false };
  const mic = useRef<MicInput | null>(null);
  const tracker = useRef(new ChordTracker(opts.capo ?? 0));
  const evidence = useRef<MicEvidence>({ frames: [], onsets: [] });
  const onsetSubs = useRef(new Set<(t: number, s: number) => void>());
  const frameSubs = useRef(new Set<(f: FrameMsg & { soundTime: number }) => void>());
  const latencyRef = useRef(latency.seconds);
  useEffect(() => {
    latencyRef.current = latency.seconds;
  }, [latency.seconds]);
  const counts = useRef({ total: 0, good: 0 });
  const lastUi = useRef(0);

  useEffect(() => {
    tracker.current.setCapo(opts.capo ?? 0);
  }, [opts.capo]);

  const handle = useCallback((m: FromWorker) => {
    const lat = latencyRef.current;
    if (m.type === "frame") {
      const f = { ...m, soundTime: m.time - lat };
      evidence.current.frames.push(f);
      if (evidence.current.frames.length > 40000) evidence.current.frames.splice(0, 10000);
      counts.current.total++;
      if (m.rmsDb > -52 && m.tonal) counts.current.good++;
      const d = tracker.current.push({ time: f.soundTime, rmsDb: m.rmsDb, tonal: m.tonal, chroma: m.chroma, bassPc: m.bassPc });
      frameSubs.current.forEach((fn) => fn(f));
      const now = performance.now();
      if (now - lastUi.current > 60) {
        lastUi.current = now;
        setDetection(d);
        setLevel(m.rmsDb);
      }
    } else if (m.type === "onset") {
      const t = m.time - lat;
      tracker.current.onset();
      evidence.current.onsets.push(t);
      onsetSubs.current.forEach((fn) => fn(t, m.strength));
    } else if (m.type === "pitch") {
      setPitch(m);
      setLevel(m.rmsDb);
    }
  }, []);

  const stop = useCallback(() => {
    mic.current?.stop();
    mic.current = null;
    setStatus((s) => (s === "on" || s === "starting" ? "off" : s));
    setDetection(null);
    setLevel(-100);
  }, []);

  const start = useCallback(async () => {
    if (mic.current) return;
    if (!micSupported()) {
      setStatus("unsupported");
      setError("This browser can't analyse microphone audio. Try a recent Chrome, Edge, Firefox or Safari.");
      return;
    }
    setStatus("starting");
    setError(null);
    const m = new MicInput({
      onMessage: handle,
      onEnded: (reason) => {
        setError(reason);
        mic.current?.stop();
        mic.current = null;
        setStatus("no-device");
      },
    });
    try {
      await m.start({ deviceId: opts.deviceId, mode: opts.mode, a4: opts.a4 });
      mic.current = m;
      setDeviceLabel(m.deviceLabel);
      if (opts.latencyMs === null) {
        // No calibration yet: estimate from what the browser reports.
        const est = outputLatency(getAudioContext()) + m.inputLatency + 0.01;
        latencyRef.current = est;
        setEstimatedLatency(est);
      }
      setStatus("on");
    } catch (e) {
      m.stop();
      const d = describeMicError(e);
      setStatus(d.status);
      setError(d.message);
    }
  }, [handle, opts.deviceId, opts.mode, opts.a4, opts.latencyMs]);

  useEffect(() => {
    mic.current?.setMode(opts.mode);
  }, [opts.mode]);

  useEffect(() => {
    mic.current?.setA4(opts.a4);
  }, [opts.a4]);

  // Always release the microphone when the component goes away.
  useEffect(() => () => mic.current?.stop(), []);

  const onOnset = useCallback((fn: (t: number, s: number) => void) => {
    onsetSubs.current.add(fn);
    return () => onsetSubs.current.delete(fn);
  }, []);
  const onFrame = useCallback((fn: (f: FrameMsg & { soundTime: number }) => void) => {
    frameSubs.current.add(fn);
    return () => frameSubs.current.delete(fn);
  }, []);
  const signalQuality = useCallback(() => (counts.current.total ? counts.current.good / counts.current.total : null), []);

  return { status, error, level, detection, pitch, latency, deviceLabel, start, stop, evidence, onOnset, onFrame, signalQuality };
}
