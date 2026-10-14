"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Notice, Pill, Select, cx } from "@/components/ui";
import { ChordDiagram } from "@/components/ChordDiagram";
import { PatternGrid } from "@/components/StrumEditor";
import { BeatLights, ClarityPill, MicButton, MicProblem, RailSection, TransportButtons, paintBeat } from "./parts";
import { useMic } from "@/lib/studio/useMic";
import { usePlayback } from "@/lib/studio/usePlayback";
import { buildSession } from "@/lib/studio/session";
import { saveSession } from "@/lib/db/db";
import type { Settings } from "@/lib/db/settings";
import type { Song, StrumSlot } from "@/lib/song/model";
import { linearBeatMap } from "@/lib/song/alignment";
import { meterInfo, formatTimeSignature, parseTimeSignature, SUPPORTED_TIME_SIGNATURES, type TimeSignature } from "@/lib/music/meter";
import { chordsCompatible, normaliseChord, parseChord } from "@/lib/music/chords";
import { shapeForChord } from "@/lib/music/shapes";
import { parsePattern, PRESET_PATTERNS, slotAtBeat } from "@/lib/coach/strum";
import { estimateTempo, tempoCurve } from "@/lib/dsp/tempo";
import { evaluateStrums, tempoStats } from "@/lib/coach/evaluate";
import { TransitionTracker } from "@/lib/coach/transitions";
import type { ChordResult } from "@/lib/coach/types";
import { nowIso } from "@/lib/song/model";
import { formatTime, useAnimationFrame } from "@/lib/hooks";
import { uniqueChords } from "@/lib/song/model";

const toneClass = { good: "text-accent", bad: "text-bad", warn: "text-warn", neutral: "text-text-2" };

function shapeOf(song: Song | null, chord: string) {
  return song?.chordShapes[chord]?.frets ?? shapeForChord(chord);
}

function parseChordList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter((c) => parseChord(c))
    .map(normaliseChord);
}

// ---------------------------------------------------------------- Free play

export function FreePlay({ settings, song }: { settings: Settings; song: Song | null }) {
  const router = useRouter();
  const mic = useMic({ mode: "chords", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs, capo: song?.capo ?? 0 });
  const [history, setHistory] = useState<Array<{ chord: string; at: number }>>([]);
  const started = useRef<number | null>(null);
  const startedIso = useRef(nowIso());
  const det = mic.status === "on" ? mic.detection : null;

  useEffect(() => {
    if (mic.status === "on" && started.current === null) started.current = performance.now();
  }, [mic.status]);

  const lastChord = history[history.length - 1]?.chord;
  useEffect(() => {
    if (det?.state === "chord" && det.chord && det.clarity !== "low" && det.chord !== lastChord) {
      const chord = det.chord;
      queueMicrotask(() => setHistory((h) => [...h.slice(-23), { chord, at: Date.now() }]));
    }
  }, [det, lastChord]);

  async function finish() {
    const secs = started.current ? (performance.now() - started.current) / 1000 : 0;
    mic.stop();
    if (secs >= 10) {
      const s = buildSession({
        songId: song?.id ?? null,
        songTitle: song?.title ?? "",
        songArtist: song?.artist ?? "",
        recordingId: null,
        mode: "free-play",
        startedAt: startedIso.current,
        activeSec: secs,
        speed: 1,
        bpm: 0,
        timingSource: "none",
        micUsed: true,
        signalQuality: mic.signalQuality(),
        results: [],
      });
      await saveSession(s);
      router.push(`/report?id=${s.id}`);
    } else router.push("/studio");
  }

  return (
    <div className="px-4 md:px-10 py-8 max-w-[980px] flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold">Free play</h1>
          <p className="text-text-2">Play anything. GuitarCoach shows the chord it thinks it hears, and how sure it is.</p>
        </div>
        <div className="flex gap-2 items-center">
          <MicButton mic={mic} />
          <Button onClick={finish}>Finish</Button>
        </div>
      </div>
      <MicProblem mic={mic} />
      <section aria-live="polite" className="rounded-2xl border border-line-soft bg-sunk px-6 py-10 flex flex-col items-center gap-3 min-h-[300px] justify-center">
        {mic.status !== "on" ? (
          <p className="text-text-3">Turn on listening to start. Audio stays on this device.</p>
        ) : det?.state === "chord" ? (
          <>
            <span className="chord-face text-[140px] leading-none text-chord" data-testid="freeplay-chord">
              {det.chord}
            </span>
            <ClarityPill det={det} />
            <p className="text-sm text-text-3">
              Also possible: {det.candidates.slice(1, 4).map((c) => c.symbol).join(", ")}
            </p>
          </>
        ) : (
          <p className={cx("text-lg", det?.state === "unclear" ? "text-warn" : "text-text-3")}>
            {det?.state === "unclear" ? "Signal unclear · Try strumming more clearly" : "Waiting for you to play"}
          </p>
        )}
      </section>
      {history.length > 0 && (
        <RailSection title="Recently heard">
          <p className="chord-face text-2xl text-text-2 flex flex-wrap gap-x-4 gap-y-1">
            {history.map((h, i) => (
              <span key={i} className={i === history.length - 1 ? "text-chord" : undefined}>
                {h.chord}
              </span>
            ))}
          </p>
        </RailSection>
      )}
      <p className="text-sm text-text-3">
        Detection compares the sound with common chord types (major, minor, sevenths, suspended and power chords). Fast strumming, heavy distortion or a
        noisy room make it less reliable, so treat it as a guide.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Chord drill

export function ChordDrill({ settings, song }: { settings: Settings; song: Song | null }) {
  const router = useRouter();
  const mic = useMic({ mode: "chords", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs, capo: song?.capo ?? 0 });
  const initial = song ? uniqueChords(song).slice(0, 12) : ["G", "C", "D", "Em", "Am"];
  const [chordText, setChordText] = useState(initial.join(" "));
  const chords = useMemo(() => parseChordList(chordText), [chordText]);
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [promptAt, setPromptAt] = useState(0);
  const [results, setResults] = useState<Array<ChordResult & { ms: number | null }>>([]);
  const [heardWrong, setHeardWrong] = useState<string | null>(null);
  const streak = useRef(0);
  const wrongStreak = useRef<{ chord: string; n: number }>({ chord: "", n: 0 });
  const startedIso = useRef(nowIso());
  const target = chords[index % Math.max(1, chords.length)] ?? null;
  const det = mic.status === "on" ? mic.detection : null;

  const advance = useCallback(
    (verdict: ChordResult["verdict"], detected?: string) => {
      if (!target) return;
      const ms = verdict === "correct" ? Math.round(performance.now() - promptAt) : null;
      setResults((r) => [
        ...r,
        { key: `drill-${r.length}`, index: r.length, expected: target, sectionName: "Chord drill", sectionIndex: 0, lineIndex: 0, expectedTime: 0, verdict, detected, timing: "unknown", ms },
      ]);
      setIndex((i) => i + 1);
      setPromptAt(performance.now());
      setHeardWrong(null);
      streak.current = 0;
      wrongStreak.current = { chord: "", n: 0 };
    },
    [target, promptAt],
  );

  useEffect(() => {
    if (!running || !target || !det || det.state !== "chord" || !det.chord) return;
    if (chordsCompatible(target, det.chord) && det.clarity !== "low") {
      streak.current++;
      if (streak.current >= 4) queueMicrotask(() => advance("correct"));
    } else if (det.clarity === "high") {
      streak.current = 0;
      const w = wrongStreak.current;
      wrongStreak.current = { chord: det.chord, n: w.chord === det.chord ? w.n + 1 : 1 };
      if (wrongStreak.current.n === 8) {
        const heard = det.chord;
        queueMicrotask(() => setHeardWrong(heard));
      }
    }
  }, [det, running, target, advance]);

  async function finish() {
    mic.stop();
    if (results.length === 0) return router.push("/studio");
    const s = buildSession({
      songId: song?.id ?? null,
      songTitle: song?.title ?? "",
      songArtist: song?.artist ?? "",
      recordingId: null,
      mode: "chord-drill",
      startedAt: startedIso.current,
      activeSec: (Date.now() - new Date(startedIso.current).getTime()) / 1000,
      speed: 1,
      bpm: 0,
      timingSource: "none",
      micUsed: true,
      signalQuality: mic.signalQuality(),
      results: results.map((r) => ({ ...r })),
    });
    await saveSession(s);
    router.push(`/report?id=${s.id}`);
  }

  const frets = target ? shapeOf(song, target) : null;
  const done = results.filter((r) => r.verdict === "correct");
  const avgMs = done.length ? Math.round(done.reduce((a, r) => a + (r.ms ?? 0), 0) / done.length) : null;

  return (
    <div className="px-4 md:px-10 py-8 max-w-[1000px] flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold">Chord drill</h1>
          <p className="text-text-2">Play each chord shape until GuitarCoach hears it clearly, then move to the next.</p>
        </div>
        <div className="flex gap-2 items-center">
          <MicButton mic={mic} />
          <Button onClick={finish}>Finish</Button>
        </div>
      </div>
      <MicProblem mic={mic} />
      <Field label="Chords to practise" htmlFor="drill-chords" hint={`${chords.length} recognised`}>
        <Input id="drill-chords" value={chordText} onChange={(e) => setChordText(e.target.value)} disabled={running} />
      </Field>
      {!running ? (
        <div>
          <Button
            variant="primary"
            size="lg"
            disabled={chords.length === 0}
            onClick={async () => {
              if (mic.status !== "on") await mic.start();
              setRunning(true);
              setIndex(0);
              setPromptAt(performance.now());
            }}
          >
            Start drill
          </Button>
        </div>
      ) : (
        target && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px] items-center">
            <section className="rounded-2xl border border-line-soft bg-sunk p-8 flex items-center gap-8 justify-center" aria-live="polite">
              {frets && <ChordDiagram name={target} frets={frets} size={150} />}
              <div className="flex flex-col gap-2">
                <span className="text-sm text-text-3">Play</span>
                <span className="chord-face text-[96px] leading-none text-chord" data-testid="drill-target">
                  {target}
                </span>
                <span className={cx("text-sm", det?.state === "chord" && det.chord && chordsCompatible(target, det.chord) ? "text-accent" : "text-text-3")}>
                  {det?.state === "chord" ? `Hearing ${det.chord}` : det?.state === "unclear" ? "Signal unclear" : "Waiting for you to play"}
                </span>
                {heardWrong && <span className="text-sm text-warn">Hearing {heardWrong} instead. Check each finger and let every string ring.</span>}
              </div>
            </section>
            <div className="flex flex-col gap-3">
              <Pill tone="good">{done.length} chords played clearly</Pill>
              {avgMs !== null && <p className="text-sm text-text-2">Average time to a clean chord: {(avgMs / 1000).toFixed(1)} s</p>}
              <Button variant="ghost" onClick={() => advance("uncertain")}>
                Skip this chord
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Rhythm drill

interface StrumHit {
  slotTime: number;
  offsetMs: number;
}

export function RhythmDrill({ settings, song }: { settings: Settings; song: Song | null }) {
  const router = useRouter();
  const [ts, setTs] = useState<TimeSignature>(song?.timeSignature ?? { numerator: 4, denominator: 4 });
  const meter = meterInfo(ts);
  const [bpm, setBpm] = useState(song?.tempo.bpm ?? 80);
  const defaultSpb = meter.isCompound ? 3 : 2;
  const songPattern = song?.strumPatterns[0];
  const presetForMeter = PRESET_PATTERNS.find((p) => p.beats === meter.beatsPerBar);
  const [patternText, setPatternText] = useState(songPattern ? songPattern.slots.join(" ") : presetForMeter?.slots ?? "D - D - D - D -");
  const [spb, setSpb] = useState(songPattern?.slotsPerBeat ?? presetForMeter?.slotsPerBeat ?? defaultSpb);
  const [chosenId, setChosenId] = useState<string>(songPattern?.id ?? "custom");
  const chosen = song?.strumPatterns.find((p) => p.id === chosenId);
  const slots = useMemo<StrumSlot[]>(
    () => chosen?.slots ?? parsePattern(patternText, Math.max(meter.beatsPerBar * spb, patternText.trim().split(/\s+/).length)) ?? Array(meter.beatsPerBar * spb).fill("-"),
    [chosen, patternText, meter.beatsPerBar, spb],
  );
  const beatMap = useMemo(() => linearBeatMap(bpm, 0), [bpm]);
  const pb = usePlayback({ blob: null, clockDuration: 3600, beatMap, beatsPerBar: meter.beatsPerBar, subdivisionsPerBeat: spb, bpm });
  const mic = useMic({ mode: "chords", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs });
  const [hits, setHits] = useState<StrumHit[]>([]);
  const [extra, setExtra] = useState(0);
  const [lastMsg, setLastMsg] = useState<{ text: string; tone: keyof typeof toneClass } | null>(null);
  const [onsetLog, setOnsetLog] = useState<Array<{ song: number; real: number }>>([]);
  const firstSongTime = onsetLog[0]?.song ?? null;
  const onsetsSong = onsetLog.map((o) => o.song);
  const onsetsReal = onsetLog.map((o) => o.real);
  const beatRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const startedIso = useRef(nowIso());
  const [elapsed, setElapsed] = useState(0);
  const tapTimes = useRef<number[]>([]);

  useEffect(() => {
    pb.setMetronomeOn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slotSec = 60 / bpm / spb;
  const tolerance = slotSec * 0.45;

  const slotTimeNear = useCallback(
    (t: number) => {
      // Nearest strummed slot to song time t.
      const slotIndex = Math.round(t / slotSec);
      let best: number | null = null;
      for (let k = slotIndex - 2; k <= slotIndex + 2; k++) {
        if (k < 0) continue;
        const pos = ((k % slots.length) + slots.length) % slots.length;
        if (slots[pos] === "-") continue;
        const st = k * slotSec;
        if (best === null || Math.abs(st - t) < Math.abs(best - t)) best = st;
      }
      return best;
    },
    [slotSec, slots],
  );

  useEffect(
    () =>
      mic.onOnset((t0) => {
        const t = pb.transport;
        if (!t || !t.isPlaying()) return;
        const songT = t.ctxToSongTime(t0);
        if (songT < 0) return;
        setOnsetLog((log) => [...log, { song: songT, real: t0 }].slice(-2000));
        const st = slotTimeNear(songT);
        if (st !== null && Math.abs(songT - st) <= tolerance) {
          const off = Math.round((songT - st) * 1000);
          setHits((h) => [...h.filter((x) => x.slotTime !== st), { slotTime: st, offsetMs: off }].slice(-400));
          const onTime = Math.abs(off) <= settings.timing.onTimeMs;
          setLastMsg({ text: onTime ? "On time" : `${Math.abs(off)} ms ${off < 0 ? "early" : "late"}`, tone: onTime ? "good" : "warn" });
        } else {
          setExtra((e) => e + 1);
          setLastMsg({ text: "Extra strum (between the pattern's strums)", tone: "warn" });
        }
      }),
    [mic, pb.transport, slotTimeNear, tolerance, settings.timing.onTimeMs],
  );

  useAnimationFrame(() => {
    const t = pb.getTime();
    const beat = beatMap.timeToBeat(t);
    paintBeat(beatRef.current, beat, pb.playing);
    if (gridRef.current) {
      const slot = pb.playing ? slotAtBeat(beat, spb, slots.length) : -1;
      gridRef.current.querySelectorAll<HTMLElement>("[data-slot]").forEach((el, i) => (el.dataset.now = String(i === slot)));
    }
    if (Math.floor(t) !== Math.floor(elapsed)) setElapsed(t);
  }, true);

  // Expected strums so far (from the first strum heard to now).
  const expectedSoFar = useMemo(() => {
    if (firstSongTime === null) return [] as number[];
    const out: number[] = [];
    const startSlot = Math.floor(firstSongTime / slotSec);
    const endSlot = Math.floor((elapsed - tolerance) / slotSec);
    for (let k = startSlot; k <= endSlot; k++) if (slots[((k % slots.length) + slots.length) % slots.length] !== "-") out.push(k * slotSec);
    return out;
  }, [elapsed, slotSec, slots, tolerance, firstSongTime]);
  const matched = hits.filter((h) => h.slotTime >= (firstSongTime ?? 0) - tolerance).length;
  const missed = Math.max(0, expectedSoFar.length - matched);
  const offsets = hits.map((h) => h.offsetMs);
  const meanAbs = offsets.length ? Math.round(offsets.reduce((a, b) => a + Math.abs(b), 0) / offsets.length) : null;
  const sd = offsets.length >= 3 ? Math.round(Math.sqrt(offsets.reduce((a, b) => a + (b - offsets.reduce((x, y) => x + y, 0) / offsets.length) ** 2, 0) / offsets.length)) : null;
  const tempo = onsetsReal.length >= 8 ? estimateTempo(onsetsReal.slice(-24), { targetBpm: bpm * pb.speed }) : null;
  const curve = onsetsReal.length >= 12 ? tempoCurve(onsetsReal, bpm * pb.speed) : [];

  async function finish() {
    pb.pause();
    mic.stop();
    const active = pb.activeSeconds();
    if (active < 5) return router.push("/studio");
    const exp: number[] = expectedSoFar;
    const s = buildSession({
      songId: song?.id ?? null,
      songTitle: song?.title ?? "",
      songArtist: song?.artist ?? "",
      recordingId: null,
      mode: "rhythm-drill",
      startedAt: startedIso.current,
      activeSec: active,
      speed: pb.speed,
      bpm: bpm * pb.speed,
      timingSource: "clock",
      micUsed: onsetsReal.length > 0,
      signalQuality: mic.signalQuality(),
      results: [],
      strum: evaluateStrums(exp, onsetsSong, tolerance, true),
      tempo: onsetsReal.length >= 8 ? tempoStats(onsetsReal, bpm * pb.speed) : undefined,
    });
    await saveSession(s);
    router.push(`/report?id=${s.id}`);
  }

  function tap() {
    const now = performance.now() / 1000;
    tapTimes.current = [...tapTimes.current.filter((x) => now - x < 4), now];
    if (tapTimes.current.length >= 3) {
      const iv = tapTimes.current.slice(1).map((x, i) => x - tapTimes.current[i]);
      const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
      setBpm(Math.round(60 / avg));
    }
  }

  return (
    <div className="px-4 md:px-10 py-8 max-w-[1100px] flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold">Rhythm drill</h1>
          <p className="text-text-2">Strum along with the click. GuitarCoach times each strum against the pattern.</p>
        </div>
        <div className="flex gap-2 items-center">
          <MicButton mic={mic} />
          <Button onClick={finish}>Finish</Button>
        </div>
      </div>
      <MicProblem mic={mic} />
      <div className="flex flex-wrap items-end gap-4">
        <TransportButtons playing={pb.playing} countingIn={pb.countingIn} onToggle={pb.toggle} onRestart={pb.restart} />
        <Field label="Tempo (BPM)" htmlFor="rd-bpm">
          <div className="flex gap-2">
            <Input id="rd-bpm" type="number" min={30} max={240} value={bpm} className="w-24" onChange={(e) => setBpm(Math.max(30, Math.min(240, Number(e.target.value) || 30)))} disabled={pb.playing} />
            <Button onClick={tap} disabled={pb.playing}>
              Tap tempo
            </Button>
          </div>
        </Field>
        <Field label="Time" htmlFor="rd-ts">
          <Select id="rd-ts" value={formatTimeSignature(ts)} onChange={(e) => setTs(parseTimeSignature(e.target.value) ?? ts)} disabled={pb.playing}>
            {SUPPORTED_TIME_SIGNATURES.map((t) => (
              <option key={formatTimeSignature(t)}>{formatTimeSignature(t)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Subdivision" htmlFor="rd-spb">
          <Select id="rd-spb" value={spb} onChange={(e) => { setChosenId("custom"); setSpb(Number(e.target.value)); }} disabled={pb.playing}>
            <option value={1}>Beats</option>
            <option value={2}>Eighths</option>
            <option value={3}>Triplets</option>
            <option value={4}>Sixteenths</option>
            <option value={6}>Sixteenth triplets</option>
          </Select>
        </Field>
        {song && song.strumPatterns.length > 0 && (
          <Field label="Song pattern" htmlFor="rd-song-pattern">
            <Select
              id="rd-song-pattern"
              value={chosenId}
              disabled={pb.playing}
              onChange={(e) => {
                const p = song.strumPatterns.find((x) => x.id === e.target.value);
                setChosenId(e.target.value);
                if (p) {
                  setSpb(p.slotsPerBeat);
                  setPatternText(p.slots.join(" "));
                  if (p.bpm) setBpm(p.bpm);
                }
              }}
            >
              {song.strumPatterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="custom">My own pattern</option>
            </Select>
          </Field>
        )}
        <Field label="Pattern" htmlFor="rd-pattern">
          <Input
            id="rd-pattern"
            className="font-mono w-64"
            value={patternText}
            onChange={(e) => {
              setChosenId("custom");
              setPatternText(e.target.value);
            }}
            disabled={pb.playing}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm pb-2.5">
          <input type="checkbox" checked={pb.subdivide} onChange={(e) => pb.setSubdivide(e.target.checked)} className="accent-[var(--accent)]" />
          Click subdivisions
        </label>
      </div>

      <section className="rounded-2xl border border-line-soft bg-sunk p-6 flex flex-col gap-5" aria-live="polite">
        <div className="flex items-center justify-between">
          <BeatLights ref={beatRef} beatsPerBar={meter.beatsPerBar} />
          <span className="text-sm text-text-3 tabular">{formatTime(elapsed)}</span>
        </div>
        <div ref={gridRef}>
          <PatternGrid slots={slots} slotsPerBeat={spb} beatsPerBar={meter.beatsPerBar} size="lg" accents={chosen?.accents} palmMutes={chosen?.palmMutes} />
        </div>
        <p className={cx("text-xl", lastMsg ? toneClass[lastMsg.tone] : "text-text-3")} data-testid="rhythm-feedback">
          {mic.status !== "on" ? "Turn on listening to time your strums." : lastMsg?.text ?? (pb.playing ? "Strum along…" : "Press play to start the click.")}
        </p>
        <OffsetStrip offsets={offsets.slice(-32)} onTimeMs={settings.timing.onTimeMs} toleranceMs={tolerance * 1000} />
      </section>

      <div className="grid gap-4 sm:grid-cols-4">
        <Metric label="Strums on the pattern" value={String(matched)} />
        <Metric label="Missed strums" value={String(missed)} />
        <Metric label="Extra strums" value={String(extra)} />
        <Metric label="Timing spread" value={sd !== null ? `±${sd} ms` : "—"} hint={meanAbs !== null ? `average ${meanAbs} ms off` : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Metric
          label="Your tempo"
          value={tempo && tempo.confidence >= 0.6 ? `${Math.round(tempo.bpm)} BPM` : "Not enough strums yet"}
          hint={tempo && tempo.confidence >= 0.6 ? `target ${Math.round(bpm * pb.speed)} BPM, drift ${tempo.driftPct.toFixed(1)}%` : "Needs at least 8 steady strums"}
        />
        <div>
          <p className="text-sm text-text-3 mb-1">Tempo over time</p>
          <TempoSparkline curve={curve} target={bpm * pb.speed} />
        </div>
      </div>
      <p className="text-sm text-text-3">
        Strums are timed from the microphone. Whether a strum went down or up isn&apos;t judged, because it can&apos;t be heard reliably; play the arrows as
        written and GuitarCoach checks that each lands on time.
      </p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-t border-line-soft pt-2">
      <p className="text-sm text-text-3">{label}</p>
      <p className="text-xl tabular">{value}</p>
      {hint && <p className="text-xs text-text-3">{hint}</p>}
    </div>
  );
}

function OffsetStrip({ offsets, onTimeMs, toleranceMs }: { offsets: number[]; onTimeMs: number; toleranceMs: number }) {
  const w = 600;
  const h = 56;
  const x = (ms: number) => w / 2 + (ms / toleranceMs) * (w / 2 - 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" role="img" aria-label="Recent strum timing: left is early, right is late">
      <rect x={x(-onTimeMs)} y={6} width={x(onTimeMs) - x(-onTimeMs)} height={h - 18} fill="var(--accent-wash)" rx={4} />
      <line x1={w / 2} x2={w / 2} y1={4} y2={h - 10} stroke="var(--accent)" strokeWidth={1.5} />
      {offsets.map((o, i) => (
        <circle key={i} cx={x(Math.max(-toleranceMs, Math.min(toleranceMs, o)))} cy={10 + (i % 6) * 6} r={3.5} fill={Math.abs(o) <= onTimeMs ? "var(--accent)" : "var(--warn)"} opacity={0.35 + (0.65 * (i + 1)) / offsets.length} />
      ))}
      <text x={6} y={h - 2} fontSize={11} fill="var(--text-3)">
        early
      </text>
      <text x={w - 6} y={h - 2} fontSize={11} fill="var(--text-3)" textAnchor="end">
        late
      </text>
    </svg>
  );
}

export function TempoSparkline({ curve, target }: { curve: Array<{ t: number; bpm: number }>; target: number }) {
  if (curve.length < 2) return <p className="text-sm text-text-3">Appears after enough steady strums.</p>;
  const w = 320;
  const h = 64;
  const t0 = curve[0].t;
  const t1 = curve[curve.length - 1].t;
  const lo = Math.min(target * 0.85, ...curve.map((c) => c.bpm));
  const hi = Math.max(target * 1.15, ...curve.map((c) => c.bpm));
  const x = (t: number) => ((t - t0) / Math.max(0.001, t1 - t0)) * (w - 4) + 2;
  const y = (b: number) => h - 4 - ((b - lo) / (hi - lo)) * (h - 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[360px] h-16" role="img" aria-label={`Tempo ranged from ${Math.round(Math.min(...curve.map((c) => c.bpm)))} to ${Math.round(Math.max(...curve.map((c) => c.bpm)))} BPM against a target of ${Math.round(target)}`}>
      <line x1={0} x2={w} y1={y(target)} y2={y(target)} stroke="var(--text-3)" strokeDasharray="4 4" />
      <polyline fill="none" stroke="var(--accent)" strokeWidth={2} points={curve.map((c) => `${x(c.t)},${y(c.bpm)}`).join(" ")} />
    </svg>
  );
}

// ---------------------------------------------------------------- Chord changes

export function TransitionTrainer({ settings, song, initialPair }: { settings: Settings; song: Song | null; initialPair?: [string, string] | null }) {
  const router = useRouter();
  const chordsInSong = song ? uniqueChords(song) : [];
  const [a, setA] = useState(initialPair?.[0] ?? chordsInSong[0] ?? "G");
  const [b, setB] = useState(initialPair?.[1] ?? chordsInSong[1] ?? "C");
  const mic = useMic({ mode: "chords", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs, capo: song?.capo ?? 0 });
  const tracker = useRef<TransitionTracker | null>(null);
  const [running, setRunning] = useState(false);
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(0);
  const [, force] = useState(0);
  const startedIso = useRef(nowIso());
  const allStats = useRef<Array<{ from: string; to: string; attempts: number; successes: number; times: number[] }>>([]);
  const det = mic.status === "on" ? mic.detection : null;

  useEffect(() => {
    if (!running || !det || !tracker.current) return;
    if (tracker.current.push(det)) queueMicrotask(() => force((x) => x + 1));
  }, [det, running]);

  useAnimationFrame(() => {
    const t = performance.now();
    if (Math.abs(t - now) > 200) setNow(t);
    if (running && t >= endsAt) stopRound();
  }, running);

  function startRound() {
    tracker.current = new TransitionTracker(normaliseChord(a), normaliseChord(b));
    setEndsAt(performance.now() + 60_000);
    setNow(performance.now());
    setRunning(true);
  }

  function stopRound() {
    setRunning(false);
    const tr = tracker.current;
    if (!tr) return;
    for (const pair of [
      [tr.a, tr.b],
      [tr.b, tr.a],
    ] as const) {
      const evs = tr.events.filter((e) => e.from === pair[0] && e.to === pair[1]);
      if (evs.length) allStats.current.push({ from: pair[0], to: pair[1], attempts: evs.length, successes: evs.filter((e) => e.ok).length, times: evs.filter((e) => e.ok).map((e) => e.gapMs) });
    }
  }

  async function finish() {
    if (running) stopRound();
    mic.stop();
    if (allStats.current.length === 0) return router.push("/studio");
    const s = buildSession({
      songId: song?.id ?? null,
      songTitle: song?.title ?? "",
      songArtist: song?.artist ?? "",
      recordingId: null,
      mode: "transition",
      startedAt: startedIso.current,
      activeSec: (Date.now() - new Date(startedIso.current).getTime()) / 1000,
      speed: 1,
      bpm: 0,
      timingSource: "none",
      micUsed: true,
      signalQuality: mic.signalQuality(),
      results: [],
      transitions: allStats.current,
    });
    await saveSession(s);
    router.push(`/report?id=${s.id}`);
  }

  const st = tracker.current?.stats();
  const remaining = running ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 60;
  const fa = shapeOf(song, normaliseChord(a));
  const fb = shapeOf(song, normaliseChord(b));
  const validPair = !!parseChord(a) && !!parseChord(b) && normaliseChord(a) !== normaliseChord(b);

  return (
    <div className="px-4 md:px-10 py-8 max-w-[1000px] flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold">Chord changes</h1>
          <p className="text-text-2">Switch between two chords as cleanly and quickly as you can for one minute.</p>
        </div>
        <div className="flex gap-2 items-center">
          <MicButton mic={mic} />
          <Button onClick={finish}>Finish</Button>
        </div>
      </div>
      <MicProblem mic={mic} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="tr-a">
          <Input id="tr-a" value={a} onChange={(e) => setA(e.target.value)} className="w-24" disabled={running} list="song-chords" />
        </Field>
        <Field label="To" htmlFor="tr-b">
          <Input id="tr-b" value={b} onChange={(e) => setB(e.target.value)} className="w-24" disabled={running} list="song-chords" />
        </Field>
        <datalist id="song-chords">
          {chordsInSong.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {!running ? (
          <Button
            variant="primary"
            size="lg"
            disabled={!validPair}
            onClick={async () => {
              if (mic.status !== "on") await mic.start();
              startRound();
            }}
          >
            Start one minute
          </Button>
        ) : (
          <Button size="lg" onClick={stopRound}>
            Stop
          </Button>
        )}
      </div>
      <section className="rounded-2xl border border-line-soft bg-sunk p-6 grid gap-6 md:grid-cols-[1fr_auto_1fr] items-center" aria-live="polite">
        <div className="flex flex-col items-center gap-2">
          {fa ? <ChordDiagram name={normaliseChord(a)} frets={fa} size={110} /> : <span className="chord-face text-5xl">{a}</span>}
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="chord-face text-[64px] leading-none tabular text-chord">{remaining}</span>
          <span className="text-sm text-text-3">seconds</span>
          <span className="text-sm text-text-2 mt-2">{det?.state === "chord" ? `Hearing ${det.chord}` : det?.state === "unclear" ? "Signal unclear" : "—"}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          {fb ? <ChordDiagram name={normaliseChord(b)} frets={fb} size={110} /> : <span className="chord-face text-5xl">{b}</span>}
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-4">
        <Metric label="Clean changes" value={String(st?.successes ?? 0)} />
        <Metric label="Changes with a stray chord" value={String((st?.attempts ?? 0) - (st?.successes ?? 0))} />
        <Metric label="Average change time" value={st?.meanMs != null ? `${(st.meanMs / 1000).toFixed(2)} s` : "—"} hint="from the last clear strum of one chord to the first of the next" />
        <Metric label="Consistency" value={st?.sdMs != null ? `±${(st.sdMs / 1000).toFixed(2)} s` : "—"} />
      </div>
      {!validPair && <Notice tone="warn">Enter two different chord names, for example G and C.</Notice>}
      <p className="text-sm text-text-3">A change only counts when both chords were heard clearly. If the audio is unclear, nothing is scored.</p>
    </div>
  );
}
