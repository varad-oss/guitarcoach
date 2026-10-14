"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SongSheet } from "@/components/SongSheet";
import { ChordDiagram } from "@/components/ChordDiagram";
import { PatternGrid } from "@/components/StrumEditor";
import { Button, ButtonLink, IconButton, Notice, Pill, Select, Toggle, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BeatLights, ClarityPill, MicButton, MicProblem, RailSection, SeekBar, SpeedControl, TransportButtons, liveVerdict, paintBeat } from "./parts";
import { useMic } from "@/lib/studio/useMic";
import { ctxNow, usePlayback, type LoopRange } from "@/lib/studio/usePlayback";
import { buildSession } from "@/lib/studio/session";
import { buildTimeline } from "@/lib/song/timeline";
import { beatMapFor, eventIndexAtTime, eventTimes, linearBeatMap, statusLabel, supportsMsTiming, type BeatMap } from "@/lib/song/alignment";
import { effectiveBpm, nowIso, type Recording, type Song } from "@/lib/song/model";
import { meterInfo } from "@/lib/music/meter";
import { shapeForChord, shapeToMidi } from "@/lib/music/shapes";
import { evaluateChords, expectedStrums, evaluateStrums, tempoStats, type SongFrame } from "@/lib/coach/evaluate";
import type { ChordResult, PracticeMode } from "@/lib/coach/types";
import { MODE_LABELS } from "@/lib/coach/types";
import { patternForSection, slotAtBeat } from "@/lib/coach/strum";
import { DisplayControls } from "@/components/DisplayControls";
import type { DisplayPrefs } from "@/lib/song/model";
import { markPlayed, saveSession, saveSettings, updateRecording } from "@/lib/db/db";
import { YouTubeTransport } from "@/lib/media/youtube";
import type { Settings } from "@/lib/db/settings";
import { formatTime, useAnimationFrame } from "@/lib/hooks";

interface Occurrence {
  idx: number;
  startCtx: number;
  startSong: number;
  endCtx?: number;
}

function describeResult(r: ChordResult): { text: string; tone: "good" | "bad" | "warn" | "neutral" } {
  if (r.verdict === "wrong") return { text: `Expected ${r.expected} · Heard ${r.detected} · Wrong chord`, tone: "bad" };
  if (r.verdict === "missed") return { text: `${r.expected} · Missed`, tone: "bad" };
  if (r.verdict === "uncertain" || r.verdict === "not-evaluated") return { text: `${r.expected} · Couldn't tell from the audio`, tone: "warn" };
  if (r.timing === "on-time") return { text: `${r.expected} · Excellent timing`, tone: "good" };
  if (r.timing === "late" || r.timing === "early") return { text: `${r.expected} · ${Math.abs(r.offsetMs ?? 0)} ms ${r.timing}`, tone: "warn" };
  if (r.timing === "missed") return { text: `${r.expected} · Correct chord, change not heard on time`, tone: "warn" };
  return { text: `${r.expected} · Correct`, tone: "good" };
}

export function PlayAlong({
  song,
  recording,
  blob,
  mode,
  settings,
  initialLoopKey,
  onModeChange,
  storedSong,
  prefs,
  onPrefsChange,
}: {
  song: Song;
  /** The song as stored (before transpose/simplify), for the toolbar's key display. */
  storedSong: Song;
  prefs: DisplayPrefs;
  onPrefsChange: (p: DisplayPrefs) => void;
  recording: Recording | null;
  blob: Blob | null;
  mode: PracticeMode;
  settings: Settings;
  initialLoopKey?: string | null;
  onModeChange: (m: PracticeMode) => void;
}) {
  const router = useRouter();
  const meter = meterInfo(song.timeSignature);
  const bpm = recording ? recording.alignment.bpm : effectiveBpm(song);
  const tl = useMemo(() => buildTimeline(song), [song]);
  const alignment = recording?.alignment ?? null;
  const [nudge, setNudge] = useState(0);
  const baseMap = useMemo<BeatMap>(() => (alignment ? beatMapFor(alignment) : linearBeatMap(bpm, 0)), [alignment, bpm]);
  const beatMap = useMemo<BeatMap>(
    () => (nudge ? { beatToTime: (b) => baseMap.beatToTime(b) + nudge, timeToBeat: (t) => baseMap.timeToBeat(t - nudge) } : baseMap),
    [baseMap, nudge],
  );
  const times = useMemo(() => {
    const et = eventTimes(tl, alignment ?? { bpm, offsetSec: 0 });
    return nudge ? et.map((x) => ({ ...x, start: x.start + nudge, end: x.end + nudge })) : et;
  }, [tl, alignment, bpm, nudge]);
  const timingSource = recording ? alignment!.status : "clock";
  const msTiming = supportsMsTiming(timingSource);
  const clockDuration = (tl.totalBeats * 60) / bpm + 2;
  const voicings = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const c of new Set(tl.events.map((e) => e.chord))) {
      const frets = song.chordShapes[c]?.frets;
      if (frets) m.set(c, shapeToMidi(frets, song.capo));
    }
    return m;
  }, [tl, song.chordShapes, song.capo]);

  const [videoEl, setVideoEl] = useState<HTMLDivElement | null>(null);
  const youtubeId = recording?.kind === "youtube" ? recording.youtubeId ?? null : null;
  const pb = usePlayback({
    blob,
    youtube: youtubeId ? { videoId: youtubeId, container: videoEl } : null,
    clockDuration,
    beatMap,
    beatsPerBar: meter.beatsPerBar,
    subdivisionsPerBeat: meter.subdivisionsPerBeat,
    bpm,
  });
  const mic = useMic({ mode: "chords", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs, capo: song.capo });

  const [activeIdx, setActiveIdx] = useState(-1);
  const [displayTime, setDisplayTime] = useState(0);
  const [follow, setFollow] = useState(settings.followMode);
  const [lastResult, setLastResult] = useState<ChordResult | null>(null);
  const [results, setResults] = useState<ChordResult[]>([]);
  // "auto" follows the current section (e.g. a pattern written for the chorus).
  const [patternChoice, setPatternChoice] = useState<string>("auto");
  const [saving, setSaving] = useState(false);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const performance_ = mode === "performance";
  const learn = mode === "learn";
  const fontScale = settings.fontScale;
  const largeChords = settings.largeChords || learn;

  const sheetRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const programmaticUntil = useRef(0);
  const occ = useRef<Occurrence | null>(null);
  const pending = useRef<Occurrence[]>([]);
  const songFrames = useRef<Array<SongFrame & { ctx: number }>>([]);
  const songOnsets = useRef<Array<{ song: number; ctx: number }>>([]);
  const realOnsets = useRef<number[]>([]);
  const resultCounter = useRef(0);
  const startedAt = useRef(nowIso());
  const savedRef = useRef(false);
  const resultsRef = useRef<ChordResult[]>([]);
  const lastDisplay = useRef(0);

  // Learn mode starts slower.
  useEffect(() => {
    if (learn && pb.ready) pb.setSpeed(0.7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learn, pb.ready]);

  useEffect(() => {
    pb.setVolume(settings.playbackVolume);
    pb.setMetronomeVolume(settings.metronome.volume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.transport, settings.playbackVolume, settings.metronome.volume]);

  // Name a YouTube recording after the video once the player knows its title.
  useEffect(() => {
    const t = pb.transport;
    if (!pb.ready || !recording || !(t instanceof YouTubeTransport) || !t.title || !recording.name.startsWith("YouTube video")) return;
    void updateRecording(recording.id, (r) => ({ ...r, name: t.title, durationSec: t.duration ?? r.durationSec }));
  }, [pb.ready, pb.transport, recording]);

  // Resume where the person left off (same recording only).
  useEffect(() => {
    if (!pb.ready) return;
    const lp = song.lastPosition;
    if (lp && lp.time > 5 && (lp.recordingId ?? null) === (recording?.id ?? null) && lp.time < pb.duration - 5) {
      pb.seek(lp.time);
      queueMicrotask(() => setResumedAt(lp.time));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.ready]);

  // Loop from the URL (e.g. "practise this section again" from a report).
  const loopOptions = useMemo<Array<LoopRange & { key: string }>>(
    () =>
      tl.sections.map((s) => ({
        key: s.key,
        start: beatMap.beatToTime(s.startBeat),
        end: beatMap.beatToTime(s.endBeat),
        label: `${s.name}${tl.sections.filter((x) => x.name === s.name).length > 1 ? ` (${s.rep + 1 + tl.sections.filter((x) => x.name === s.name && x.startBeat < s.startBeat && x.rep === 0).length})` : ""}`,
      })),
    [tl, beatMap],
  );
  useEffect(() => {
    if (!initialLoopKey || !pb.ready) return;
    const l = loopOptions.find((o) => o.key === initialLoopKey);
    if (l) {
      pb.setLoop(l);
      pb.seek(l.start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoopKey, pb.ready]);

  // Collect evidence only while the music runs.
  useEffect(
    () =>
      mic.onFrame((f) => {
        const t = pb.transport;
        if (!t || !t.isPlaying()) return;
        songFrames.current.push({ time: f.soundTime, rmsDb: f.rmsDb, tonal: f.tonal, chroma: f.chroma, bassPc: f.bassPc, songTime: t.ctxToSongTime(f.soundTime), ctx: f.soundTime });
        if (songFrames.current.length > 30000) songFrames.current.splice(0, 5000);
      }),
    [mic, pb.transport],
  );
  useEffect(
    () =>
      mic.onOnset((t0) => {
        const t = pb.transport;
        if (!t || !t.isPlaying()) return;
        songOnsets.current.push({ song: t.ctxToSongTime(t0), ctx: t0 });
        realOnsets.current.push(t0);
      }),
    [mic, pb.transport],
  );

  const evaluateOccurrence = useCallback(
    (o: Occurrence) => {
      if (o.idx < 0 || o.idx >= times.length) return;
      const ev = tl.events[o.idx];
      const t = times[o.idx];
      const end = o.endCtx ?? ctxNow();
      const frames = songFrames.current.filter((f) => f.ctx >= o.startCtx - 0.6 && f.ctx <= end + 0.6);
      if (frames.length === 0) return; // microphone was off
      const onsets = songOnsets.current.filter((x) => x.ctx >= o.startCtx - 0.6 && x.ctx <= end + 0.6).map((x) => x.song);
      const joinedLate = o.startSong > t.start + 0.12;
      const [r] = evaluateChords(
        [
          {
            key: ev.key,
            index: resultCounter.current++,
            chord: ev.chord,
            sectionName: ev.sectionName,
            sectionIndex: ev.sectionIndex,
            lineIndex: ev.lineIndex,
            start: t.start,
            end: t.end,
            voicing: voicings.get(ev.chord),
          },
        ],
        frames,
        onsets,
        { capo: song.capo, onTimeMs: settings.timing.onTimeMs, windowMs: settings.timing.windowMs, msTiming: msTiming && !joinedLate },
      );
      if (r.verdict === "not-evaluated") return;
      resultsRef.current = [...resultsRef.current, r];
      setResults(resultsRef.current);
      setLastResult(r);
    },
    [times, tl, voicings, song.capo, settings.timing, msTiming],
  );

  const flushPending = useCallback(
    (all = false) => {
      const now = ctxNow();
      const wait = settings.timing.windowMs / 1000 + 0.3;
      const ready = pending.current.filter((o) => all || (o.endCtx ?? now) + wait < now);
      pending.current = pending.current.filter((o) => !ready.includes(o));
      ready.forEach(evaluateOccurrence);
    },
    [evaluateOccurrence, settings.timing.windowMs],
  );

  const activeEvent = activeIdx >= 0 ? tl.events[activeIdx] : null;
  const patternFor = (sectionIndex: number | undefined) =>
    patternChoice === "auto" ? patternForSection(song.strumPatterns, sectionIndex !== undefined ? song.sections[sectionIndex]?.kind : undefined) : song.strumPatterns.find((p) => p.id === patternChoice);
  const pattern = patternFor(activeEvent?.sectionIndex ?? tl.events[0]?.sectionIndex);

  // Per-frame: active chord, scrolling, beat lights, progress, evaluation.
  useAnimationFrame(() => {
    const t = pb.getTime();
    const idx = eventIndexAtTime(times, t);
    const playing = pb.transport?.isPlaying() ?? false;
    if (playing) {
      if (!occ.current || occ.current.idx !== idx) {
        const now = ctxNow();
        if (occ.current) pending.current.push({ ...occ.current, endCtx: now });
        occ.current = { idx, startCtx: now, startSong: t };
      }
    } else if (occ.current) {
      pending.current.push({ ...occ.current, endCtx: ctxNow() });
      occ.current = null;
    }
    flushPending();
    if (idx !== activeIdx) setActiveIdx(idx);
    const now = performance.now();
    if (now - lastDisplay.current > 200) {
      lastDisplay.current = now;
      setDisplayTime(t);
    }
    const beat = beatMap.timeToBeat(t);
    paintBeat(beatRef.current, beat, playing);
    if (progressRef.current) {
      const cur = times[idx];
      const frac = cur ? Math.max(0, Math.min(1, (t - cur.start) / (cur.end - cur.start))) : 0;
      progressRef.current.style.transform = `scaleX(${frac})`;
    }
    if (slotRef.current && pattern) {
      const slot = playing ? slotAtBeat(beat, pattern.slotsPerBeat, pattern.slots.length) : -1;
      slotRef.current.querySelectorAll<HTMLElement>("[data-slot]").forEach((el, i) => (el.dataset.now = String(i === slot)));
    }
  }, true);

  const nextEvent = tl.events[activeIdx + 1] ?? null;
  const upcoming = tl.events.slice(activeIdx + 2, activeIdx + 5);
  const firstEvent = tl.events[0] ?? null;
  const expectedNow = activeEvent?.chord ?? null;

  // Follow mode: keep the active line in view.
  useEffect(() => {
    if (!follow || !activeEvent || !sheetRef.current) return;
    const el = sheetRef.current.querySelector<HTMLElement>(`[data-line-id="${activeEvent.lineId}"]`);
    if (!el) return;
    const c = sheetRef.current;
    const top = el.offsetTop - c.clientHeight * 0.3;
    programmaticUntil.current = performance.now() + 700;
    c.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeEvent, follow]);

  const userScrolled = () => {
    if (performance.now() > programmaticUntil.current && pb.playing && follow) setFollow(false);
  };

  const onLineClick = useCallback(
    (lineId: string) => {
      const t = pb.getTime();
      const candidates = tl.events.map((e, i) => ({ e, i })).filter((x) => x.e.lineId === lineId);
      if (!candidates.length) return;
      const best = candidates.reduce((a, b) => (Math.abs(times[b.i].start - t) < Math.abs(times[a.i].start - t) ? b : a));
      const uncertain = recording && (alignment?.status === "none" || alignment?.status === "estimated");
      if (pb.playing && uncertain) {
        // "I'm here": shift the estimated timeline so this line starts now.
        setNudge((n) => n + (t - times[best.i].start));
      } else {
        pb.seek(times[best.i].start);
      }
      setFollow(true);
    },
    [pb, tl, times, recording, alignment],
  );

  const finish = useCallback(async () => {
    if (savedRef.current) return;
    pb.pause();
    if (occ.current) {
      pending.current.push({ ...occ.current, endCtx: ctxNow() });
      occ.current = null;
    }
    flushPending(true);
    const active = pb.activeSeconds();
    const all = resultsRef.current;
    if (active < 3 && all.length === 0) {
      router.push(`/song?id=${song.id}`);
      return;
    }
    setSaving(true);
    savedRef.current = true;
    let strum;
    if (song.strumPatterns.length && songOnsets.current.length && msTiming) {
      const played = songOnsets.current.map((x) => x.song);
      const from = Math.floor(beatMap.timeToBeat(Math.min(...played)));
      const to = Math.ceil(beatMap.timeToBeat(Math.max(...played)));
      // Each section is checked against its own pattern.
      const exp: number[] = [];
      let tolerance = Infinity;
      for (const span of tl.sections) {
        const a = Math.max(from, span.startBeat);
        const b = Math.min(to, span.endBeat);
        const p = patternFor(span.sectionIndex);
        if (b <= a || !p) continue;
        exp.push(...expectedStrums(p.slots, p.slotsPerBeat, (x) => beatMap.beatToTime(x), meter.beatsPerBar, a, b));
        tolerance = Math.min(tolerance, (60 / bpm / p.slotsPerBeat) * 0.45);
      }
      if (exp.length) strum = evaluateStrums(exp, played, tolerance, true);
    }
    const session = buildSession({
      songId: song.id,
      songTitle: song.title,
      songArtist: song.artist,
      recordingId: recording?.id ?? null,
      mode,
      startedAt: startedAt.current,
      activeSec: active,
      speed: pb.speed,
      bpm: bpm * pb.speed,
      timingSource,
      micUsed: songFrames.current.length > 0,
      signalQuality: mic.signalQuality(),
      results: all,
      strum,
      tempo: realOnsets.current.length >= 8 ? tempoStats(realOnsets.current, bpm * pb.speed) : undefined,
      range: pb.loop ? { startBeat: beatMap.timeToBeat(pb.loop.start), endBeat: beatMap.timeToBeat(pb.loop.end), label: pb.loop.label } : undefined,
    });
    await saveSession(session);
    await markPlayed(song.id, { recordingId: recording?.id ?? null, time: pb.getTime() });
    mic.stop();
    router.push(`/report?id=${session.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb, flushPending, router, song, patternChoice, msTiming, beatMap, meter.beatsPerBar, bpm, recording, mode, timingSource, mic, tl]);

  useEffect(() => {
    pb.onEnded(() => void finish());
  }, [pb, finish]);

  // Mark as played once playback starts.
  const markedRef = useRef(false);
  useEffect(() => {
    if (pb.playing && !markedRef.current) {
      markedRef.current = true;
      void markPlayed(song.id);
    }
  }, [pb.playing, song.id]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const lineStarts = [...new Map(tl.events.map((ev, i) => [`${ev.lineId}:${ev.sectionRep}:${ev.lineRep}`, times[i].start])).values()].sort((a, b) => a - b);
      const t = pb.getTime();
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          pb.toggle();
          break;
        case "r":
          pb.restart();
          break;
        case "ArrowRight": {
          e.preventDefault();
          const n = lineStarts.find((s) => s > t + 0.05);
          if (n !== undefined) pb.seek(n);
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const prev = [...lineStarts].reverse().find((s) => s < t - 1);
          pb.seek(prev ?? 0);
          break;
        }
        case "m":
          pb.setMetronomeOn(!pb.metronomeOn);
          break;
        case "f":
          setFollow((f) => !f);
          break;
        case "l": {
          if (pb.loop) pb.setLoop(null);
          else {
            const cur = loopOptions.find((o) => t >= o.start && t < o.end);
            if (cur) pb.setLoop(cur);
          }
          break;
        }
        case "-":
          pb.setSpeed(Math.round((pb.speed - 0.05) * 100) / 100);
          break;
        case "=":
        case "+":
          pb.setSpeed(Math.round((pb.speed + 0.05) * 100) / 100);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pb, tl, times, loopOptions]);

  const live = liveVerdict(mic.status === "on" ? mic.detection : null, pb.playing ? expectedNow : null);
  const resultLine = lastResult ? describeResult(lastResult) : null;
  const judged = results.filter((r) => r.verdict === "correct" || r.verdict === "wrong" || r.verdict === "missed");
  const correct = results.filter((r) => r.verdict === "correct").length;
  const timed = results.filter((r) => r.timing === "on-time" || r.timing === "early" || r.timing === "late");
  const onTime = timed.filter((r) => r.timing === "on-time").length;
  const diagramChord = expectedNow ?? firstEvent?.chord ?? null;
  const diagramFrets = diagramChord ? song.chordShapes[diagramChord]?.frets ?? shapeForChord(diagramChord) : null;
  const toneClass = { good: "text-accent", bad: "text-bad", warn: "text-warn", neutral: "text-text-2" };

  if (tl.events.length === 0) {
    return (
      <div className="p-8 max-w-[640px]">
        <Notice tone="info" title="This song has no chords to play along with yet" action={<ButtonLink href={`/song?id=${song.id}&tab=edit`}>Add chords</ButtonLink>}>
          You can still use Free play, the tuner or the rhythm drill.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-56px-64px)] md:h-dvh">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-line-soft">
        <div className="min-w-0 mr-auto flex items-center gap-2">
          <Link href={`/song?id=${song.id}`} className="text-text-3 hover:text-text" aria-label="Back to song">
            <Icon name="chevronLeft" size={20} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-semibold leading-tight">{song.title}</h1>
            <p className="truncate text-sm text-text-3 leading-tight">
              {song.artist}
              {song.capo ? `, capo ${song.capo}` : ""}
            </p>
          </div>
        </div>
        <TransportButtons playing={pb.playing} countingIn={pb.countingIn} onToggle={pb.toggle} onRestart={pb.restart} disabled={!pb.ready} />
        <div className="hidden lg:flex min-w-[220px] max-w-[360px] flex-1">
          <SeekBar time={displayTime} duration={pb.duration} onSeek={pb.seek} />
        </div>
        <div className="flex items-baseline gap-1" title="Target tempo at the current speed">
          <span className="chord-face text-xl tabular">{Math.round(bpm * pb.speed)}</span>
          <span className="text-sm text-text-3">BPM</span>
        </div>
        <SpeedControl speed={pb.speed} onChange={pb.setSpeed} pitchPreserved={pb.pitchPreserved} />
        <MicButton mic={mic} />
        <Select aria-label="Practice mode" value={mode} onChange={(e) => onModeChange(e.target.value as PracticeMode)} className="h-9">
          {(["learn", "full-song", "performance", "chord-drill", "rhythm-drill", "free-play", "transition"] as PracticeMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="primary" onClick={finish} disabled={saving} data-testid="finish-session">
          Finish
        </Button>
      </div>
      <div className="lg:hidden px-4 py-1.5 border-b border-line-soft">
        <SeekBar time={displayTime} duration={pb.duration} onSeek={pb.seek} testId="time-mobile" />
      </div>

      {/* Compact current/next chord and feedback for small screens (the rail is hidden there). */}
      <div className="md:hidden flex items-center gap-4 px-4 py-2 border-b border-line-soft" aria-live="polite">
        <span className="chord-face text-[44px] leading-none text-chord">{activeEvent?.chord ?? firstEvent?.chord ?? "–"}</span>
        <span className="chord-face text-2xl text-text-3">{(activeIdx < 0 ? tl.events[1] : nextEvent)?.chord ?? ""}</span>
        <p className={cx("text-sm flex-1 min-w-0", toneClass[(mic.status === "on" ? (resultLine ?? live) : live).tone])}>
          {mic.status === "on" ? (resultLine ? `Last change: ${resultLine.text}` : live.text) : "Turn on listening for feedback"}
        </p>
      </div>

      {pb.loadError && (
        <div className="px-4 pt-3">
          <Notice tone="bad">{pb.loadError}</Notice>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row relative">
        {youtubeId && (
          <div
            className="shrink-0 w-full max-h-[34vh] md:max-h-none md:absolute md:top-4 md:right-4 md:w-[308px] z-10 aspect-video bg-black rounded-none md:rounded-lg overflow-hidden"
            data-testid="youtube-player"
          >
            <div ref={setVideoEl} className="w-full h-full [&>*]:w-full [&>*]:h-full" />
          </div>
        )}
        <div
          ref={sheetRef}
          className="flex-1 min-w-0 overflow-y-auto scroll-thin px-5 md:px-10 py-6 relative"
          onWheel={userScrolled}
          onTouchMove={userScrolled}
          data-testid="sheet-scroller"
        >
          {resumedAt !== null && (
            <div className="mb-4 flex items-center gap-2 text-sm text-text-3">
              Resumed at {formatTime(resumedAt)}.
              <button type="button" className="text-accent hover:underline" onClick={() => { pb.seek(0); setResumedAt(null); }}>
                Start from the beginning
              </button>
            </div>
          )}
          {recording && (alignment?.status === "none" || alignment?.status === "estimated") && (
            <div className="mb-4">
              <Notice
                tone="info"
                action={
                  <ButtonLink href={`/align?song=${song.id}&rec=${recording.id}`} size="sm" icon="clock">
                    Align timing
                  </ButtonLink>
                }
              >
                {alignment.status === "none"
                  ? "The recording's timing hasn't been set, so scrolling follows an estimated pace."
                  : "Timing is estimated from the audio, so scrolling is guided and changes aren't timed to the millisecond."}{" "}
                While it plays, click the line you&apos;re on to resync.
              </Notice>
            </div>
          )}
          <SongSheet
            sections={song.sections}
            fontScale={fontScale}
            largeChords={largeChords}
            activeLineId={activeEvent?.lineId ?? null}
            activeEventId={activeEvent?.eventId ?? null}
            showNotes={false}
            hideChords={prefs.hideChords}
            onLineClick={onLineClick}
          />
          <div className="h-[50vh]" aria-hidden="true" />
          {!follow && pb.playing && (
            <div className="sticky bottom-4 flex justify-center pointer-events-none">
              <Button className="pointer-events-auto shadow-lg" variant="primary" size="sm" onClick={() => setFollow(true)}>
                Follow playback
              </Button>
            </div>
          )}
        </div>

        {/* Right rail */}
        <aside
          className={cx("hidden md:flex flex-col gap-4 border-l border-line-soft overflow-y-auto scroll-thin p-4", performance_ && !youtubeId ? "w-[220px]" : "w-[340px]", youtubeId && "md:pt-[204px]")}
          aria-label="Practice feedback"
        >
          <section aria-live="polite" aria-label="Current chord">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-3">{activeEvent?.sectionName || (activeIdx < 0 ? "Get ready" : "")}</span>
              <BeatLights ref={beatRef} beatsPerBar={meter.beatsPerBar} />
            </div>
            <div className="flex items-end gap-4 mt-1">
              <span className={cx("chord-face leading-none text-chord", performance_ ? "text-[56px]" : "text-[96px]")} data-testid="now-chord">
                {activeEvent?.chord ?? firstEvent?.chord ?? "–"}
              </span>
              <div className="pb-2 min-w-0">
                <span className="text-xs text-text-3 block">Next</span>
                <span className="chord-face text-[34px] leading-none text-text-2" data-testid="next-chord">
                  {(activeIdx < 0 ? tl.events[1] : nextEvent)?.chord ?? "–"}
                </span>
              </div>
            </div>
            <div className="h-1 rounded-full bg-surface-3 mt-3 overflow-hidden">
              <div ref={progressRef} className="h-full bg-accent origin-left" style={{ transform: "scaleX(0)" }} />
            </div>
            {!performance_ && upcoming.length > 0 && (
              <p className="mt-2 text-sm text-text-3">
                Then <span className="chord-face text-text-2 text-base">{upcoming.map((u) => u.chord).join("  ")}</span>
              </p>
            )}
          </section>

          {!performance_ && (settings.showDiagrams || learn) && diagramFrets && diagramChord && (
            <div className="flex justify-center">
              <ChordDiagram name={diagramChord} frets={diagramFrets} size={learn ? 112 : 88} />
            </div>
          )}

          <RailSection title="What GuitarCoach hears" aside={<ClarityPill det={mic.status === "on" ? mic.detection : null} />}>
            <MicProblem mic={mic} />
            {mic.status === "on" ? (
              <>
                {recording && <p className="text-xs text-text-3 mb-1">Use headphones so the microphone hears only your guitar, not the recording.</p>}
                <p className={cx("text-[15px]", toneClass[live.tone])} data-testid="live-verdict">
                  {live.text}
                </p>
                {resultLine && !performance_ && (
                  <p className={cx("text-sm mt-1.5", toneClass[resultLine.tone])} data-testid="last-result">
                    Last change: {resultLine.text}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-text-3">Turn on listening to get feedback on the chords you play. Audio stays on this device.</p>
            )}
          </RailSection>

          {!performance_ && (
            <RailSection title="This session">
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-text-3">Chords checked</dt>
                <dd className="tabular text-right">{judged.length}</dd>
                <dt className="text-text-3">Correct</dt>
                <dd className="tabular text-right">{judged.length ? `${Math.round((correct / judged.length) * 100)}%` : "—"}</dd>
                <dt className="text-text-3">Changes on time</dt>
                <dd className="tabular text-right">{msTiming ? (timed.length ? `${Math.round((onTime / timed.length) * 100)}%` : "—") : "Not timed"}</dd>
                <dt className="text-text-3">Couldn&apos;t tell</dt>
                <dd className="tabular text-right">{results.filter((r) => r.verdict === "uncertain").length}</dd>
              </dl>
            </RailSection>
          )}

          {!performance_ && song.strumPatterns.length > 0 && (
            <RailSection
              title="Strumming"
              aside={
                song.strumPatterns.length > 1 ? (
                  <Select aria-label="Strumming pattern" value={patternChoice} onChange={(e) => setPatternChoice(e.target.value)} className="h-7 text-sm max-w-[170px]">
                    <option value="auto">Follow the section</option>
                    {song.strumPatterns.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                ) : null
              }
            >
              {pattern && (
                <div ref={slotRef}>
                  <p className="text-sm text-text-2 mb-1.5" data-testid="current-pattern">
                    {pattern.name}
                    {pattern.bpm ? <span className="text-text-3">, {pattern.bpm} BPM</span> : null}
                  </p>
                  <SlottedPattern pattern={pattern} beatsPerBar={meter.beatsPerBar} />
                </div>
              )}
            </RailSection>
          )}

          {!performance_ && (
            <RailSection title="Timing">
              <p className="text-sm text-text-2">{timingSource === "clock" ? "Exact: following GuitarCoach's metronome." : statusLabel(timingSource)}</p>
              {mic.status === "on" && !mic.latency.measured && (
                <p className="text-sm text-text-3 mt-1">
                  Latency isn&apos;t calibrated (using about {Math.round(mic.latency.seconds * 1000)} ms).{" "}
                  <Link className="text-accent hover:underline" href="/settings#latency">
                    Calibrate
                  </Link>
                </p>
              )}
            </RailSection>
          )}
        </aside>
      </div>

      {/* Bottom bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 border-t border-line-soft text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pb.metronomeOn} onChange={(e) => pb.setMetronomeOn(e.target.checked)} className="accent-[var(--accent)]" />
          Metronome
        </label>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.05}
          defaultValue={settings.metronome.volume}
          aria-label="Metronome volume"
          className="w-20"
          onChange={(e) => pb.setMetronomeVolume(Number(e.target.value))}
          onMouseUp={(e) => saveSettings((s) => ({ ...s, metronome: { ...s.metronome, volume: Number((e.target as HTMLInputElement).value) } }))}
        />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pb.subdivide} onChange={(e) => pb.setSubdivide(e.target.checked)} className="accent-[var(--accent)]" />
          {meter.isCompound ? "Triplet clicks" : "Eighth clicks"}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pb.countIn} onChange={(e) => pb.setCountIn(e.target.checked)} className="accent-[var(--accent)]" />
          Count-in
        </label>
        <label className="flex items-center gap-2">
          <Icon name="loop" size={16} className={pb.loop ? "text-accent" : "text-text-3"} />
          <Select
            aria-label="Loop a section"
            className="h-8"
            value={pb.loop ? loopOptions.find((o) => o.label === pb.loop!.label)?.key ?? "" : ""}
            onChange={(e) => {
              const o = loopOptions.find((x) => x.key === e.target.value);
              pb.setLoop(o ?? null);
              if (o) pb.seek(o.start);
            }}
          >
            <option value="">No loop</option>
            {loopOptions.map((o) => (
              <option key={o.key} value={o.key}>
                Loop {o.label}
              </option>
            ))}
          </Select>
        </label>
        <Toggle checked={follow} onChange={setFollow} label="Follow" />
        <div className="flex items-center gap-1">
          <IconButton icon="chevronDown" label="Smaller text" size={30} onClick={() => saveSettings({ fontScale: Math.max(0.8, Math.round((fontScale - 0.1) * 10) / 10) })} />
          <span className="tabular text-text-3 w-10 text-center">{Math.round(fontScale * 100)}%</span>
          <IconButton icon="chevronDown" label="Larger text" size={30} className="rotate-180" onClick={() => saveSettings({ fontScale: Math.min(2.2, Math.round((fontScale + 0.1) * 10) / 10) })} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={largeChords} disabled={learn} onChange={(e) => saveSettings({ largeChords: e.target.checked })} className="accent-[var(--accent)]" />
          Large chords
        </label>
        {recording && (
          <label className="flex items-center gap-2">
            {youtubeId ? "Video volume" : "Song volume"}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={settings.playbackVolume}
              aria-label="Song volume"
              className="w-20"
              onChange={(e) => pb.setVolume(Number(e.target.value))}
              onMouseUp={(e) => saveSettings({ playbackVolume: Number((e.target as HTMLInputElement).value) })}
            />
          </label>
        )}
        <div className="basis-full lg:basis-auto">
          <DisplayControls song={storedSong} prefs={prefs} onChange={onPrefsChange} compact />
        </div>
        <span className="ml-auto text-text-3 hidden 2xl:inline">Space play/pause, ← → lines, L loop, M metronome, F follow</span>
        {!pb.pitchPreserved && pb.speed !== 1 && <Pill tone="warn">Slowing down changes pitch in this browser</Pill>}
      </div>
    </div>
  );
}

function SlottedPattern({ pattern, beatsPerBar }: { pattern: Song["strumPatterns"][number]; beatsPerBar: number }) {
  return (
    <div>
      <PatternGrid slots={pattern.slots} slotsPerBeat={pattern.slotsPerBeat} beatsPerBar={beatsPerBar} accents={pattern.accents} palmMutes={pattern.palmMutes} />
      <p className="text-xs text-text-3 mt-1.5">Strum timing is checked from the microphone; strum direction is not.</p>
    </div>
  );
}
