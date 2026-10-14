/**
 * Turns the audio evidence gathered during a session into per-chord results,
 * strum statistics and tempo statistics. Uncertain evidence is reported as
 * uncertain — never as a mistake.
 */

import { transposeChord } from "../music/chords";
import { expectedTemplates, judgeFrame } from "../dsp/chordTemplates";
import { estimateTempo, tempoCurve } from "../dsp/tempo";
import type { AnalysisFrame } from "./chordTracker";
import { SILENCE_DB } from "./chordTracker";
import type { ChordResult, SessionSummary, StrumStats, TempoStats, TimingVerdict } from "./types";
import type { StrumSlot } from "../song/model";

export interface ExpectedEvent {
  key: string;
  index: number;
  /** Chord as written (shape name). */
  chord: string;
  sectionName: string;
  sectionIndex: number;
  lineIndex: number;
  /** Song time, seconds. */
  start: number;
  end: number;
  /** Sounding MIDI notes of the voicing, if known (capo applied). */
  voicing?: number[];
}

/** A frame already mapped onto song time (latency-compensated). */
export interface SongFrame extends AnalysisFrame {
  songTime: number;
}

export interface EvaluationConfig {
  capo: number;
  onTimeMs: number;
  windowMs: number;
  /** Whether the timeline is trustworthy enough for millisecond timing. */
  msTiming: boolean;
}

export function evaluateChords(events: ExpectedEvent[], frames: SongFrame[], onsets: number[], cfg: EvaluationConfig): ChordResult[] {
  const sortedFrames = [...frames].sort((a, b) => a.songTime - b.songTime);
  const sortedOnsets = [...onsets].sort((a, b) => a - b);
  const audible = (t0: number, t1: number) => sortedFrames.some((f) => f.songTime >= t0 && f.songTime < t1 && f.rmsDb > SILENCE_DB);

  return events.map((ev) => {
    const sounding = cfg.capo ? transposeChord(ev.chord, cfg.capo) : ev.chord;
    const templates = expectedTemplates(sounding, ev.voicing);
    const winStart = ev.start + 0.12;
    const winEnd = Math.min(ev.end, ev.start + 2.5);
    const base: ChordResult = {
      key: ev.key,
      index: ev.index,
      expected: ev.chord,
      sectionName: ev.sectionName,
      sectionIndex: ev.sectionIndex,
      lineIndex: ev.lineIndex,
      expectedTime: ev.start,
      verdict: "not-evaluated",
      timing: "unknown",
    };
    if (winEnd - winStart < 0.15) return base;

    const inWin = sortedFrames.filter((f) => f.songTime >= winStart && f.songTime < winEnd);
    const tonal = inWin.filter((f) => f.tonal && f.rmsDb > SILENCE_DB);
    const silentWindow = inWin.length > 0 && inWin.every((f) => f.rmsDb <= SILENCE_DB);
    const playedAround = audible(ev.start - 4, ev.start) || audible(winEnd, winEnd + 4);

    let match = 0;
    let mismatch = 0;
    const rivals = new Map<string, number>();
    let scoreSum = 0;
    for (const f of tonal) {
      const j = judgeFrame(f.chroma, sounding, templates, f.bassPc);
      scoreSum += j.expectedScore;
      if (j.verdict === "match") match++;
      else if (j.verdict === "mismatch" && j.competitor) {
        mismatch++;
        rivals.set(j.competitor.symbol, (rivals.get(j.competitor.symbol) ?? 0) + 1);
      }
    }
    const clear = match + mismatch;
    if (tonal.length >= 3 && clear >= 3) {
      if (match / clear >= 0.5) {
        base.verdict = "correct";
        base.confidence = Math.min(1, match / tonal.length);
      } else if (mismatch / clear >= 0.6) {
        const [rival] = [...rivals.entries()].sort((a, b) => b[1] - a[1]);
        base.verdict = "wrong";
        base.detected = cfg.capo ? transposeChord(rival[0], -cfg.capo) : rival[0];
        base.confidence = Math.min(1, mismatch / tonal.length);
      } else {
        base.verdict = "uncertain";
        base.confidence = clear / Math.max(1, tonal.length);
      }
    } else if (silentWindow && playedAround) {
      base.verdict = "missed";
    } else if (inWin.length > 0) {
      base.verdict = "uncertain";
    }
    void scoreSum;

    // Timing of the change.
    if (cfg.msTiming && base.verdict !== "not-evaluated") {
      const w = cfg.windowMs / 1000;
      let nearest: number | null = null;
      for (const t of sortedOnsets) {
        if (t < ev.start - w) continue;
        if (t > ev.start + w) break;
        if (nearest === null || Math.abs(t - ev.start) < Math.abs(nearest - ev.start)) nearest = t;
      }
      if (nearest !== null) {
        const off = (nearest - ev.start) * 1000;
        base.offsetMs = Math.round(off);
        base.timing = timingVerdict(off, cfg.onTimeMs);
      } else {
        base.timing = base.verdict === "missed" || audible(ev.start - 0.5, ev.start + 0.5) ? "missed" : "unknown";
      }
    }
    return base;
  });
}

export function timingVerdict(offsetMs: number, onTimeMs: number): TimingVerdict {
  if (Math.abs(offsetMs) <= onTimeMs) return "on-time";
  return offsetMs < 0 ? "early" : "late";
}

/** Expected strum times for a pattern over a span of bars (song time). */
export function expectedStrums(
  slots: StrumSlot[],
  slotsPerBeat: number,
  beatTimes: (beat: number) => number,
  beatsPerBar: number,
  fromBeat: number,
  toBeat: number,
): number[] {
  // The pattern repeats from the start of the song; it may be shorter or longer than a bar.
  void beatsPerBar;
  const out: number[] = [];
  if (slots.length === 0) return out;
  for (let k = Math.ceil(fromBeat * slotsPerBeat - 1e-9) || 0; k / slotsPerBeat < toBeat; k++) {
    const s = slots[((k % slots.length) + slots.length) % slots.length];
    if (s === "D" || s === "U" || s === "x") out.push(beatTimes(k / slotsPerBeat));
  }
  return out;
}

export function evaluateStrums(expected: number[], onsets: number[], toleranceSec: number, msTiming: boolean): StrumStats {
  if (!msTiming || expected.length === 0) {
    return { evaluated: false, expected: expected.length, matched: 0, missed: 0, extra: 0, meanAbsOffsetMs: null, stdOffsetMs: null };
  }
  const used = new Set<number>();
  const offsets: number[] = [];
  for (const e of expected) {
    let best = -1;
    for (let i = 0; i < onsets.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(onsets[i] - e);
      if (d <= toleranceSec && (best < 0 || d < Math.abs(onsets[best] - e))) best = i;
    }
    if (best >= 0) {
      used.add(best);
      offsets.push((onsets[best] - e) * 1000);
    }
  }
  const lo = expected[0] - toleranceSec;
  const hi = expected[expected.length - 1] + toleranceSec;
  const extra = onsets.filter((t, i) => !used.has(i) && t >= lo && t <= hi).length;
  const mean = offsets.reduce((a, b) => a + b, 0) / Math.max(1, offsets.length);
  const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, offsets.length));
  return {
    evaluated: true,
    expected: expected.length,
    matched: offsets.length,
    missed: expected.length - offsets.length,
    extra,
    meanAbsOffsetMs: offsets.length ? Math.round(offsets.reduce((a, b) => a + Math.abs(b), 0) / offsets.length) : null,
    stdOffsetMs: offsets.length >= 3 ? Math.round(sd) : null,
  };
}

/** Tempo statistics from real-time onset times (seconds). */
export function tempoStats(realOnsets: number[], targetBpm: number): TempoStats {
  const est = estimateTempo(realOnsets, { targetBpm });
  return {
    targetBpm,
    estimatedBpm: est && est.confidence >= 0.6 ? est.bpm : null,
    driftPct: est && est.confidence >= 0.6 ? Math.round(est.driftPct * 10) / 10 : null,
    onsetCount: realOnsets.length,
    samples: tempoCurve(realOnsets, targetBpm),
  };
}

export function summarize(results: ChordResult[], strum?: StrumStats, tempo?: TempoStats): SessionSummary {
  const count = (v: ChordResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  const correct = count("correct");
  const wrong = count("wrong");
  const missed = count("missed");
  const uncertain = count("uncertain");
  const evaluated = correct + wrong + missed;
  const timed = results.filter((r) => r.timing === "on-time" || r.timing === "early" || r.timing === "late");
  const onTime = timed.filter((r) => r.timing === "on-time").length;
  const offsets = timed.map((r) => Math.abs(r.offsetMs ?? 0));
  return {
    chordTotal: results.length,
    chordEvaluated: evaluated,
    correct,
    wrong,
    missed,
    uncertain,
    chordAccuracy: evaluated > 0 ? correct / evaluated : null,
    timingEvaluated: timed.length,
    onTime,
    early: timed.filter((r) => r.timing === "early").length,
    late: timed.filter((r) => r.timing === "late").length,
    timingAccuracy: timed.length > 0 ? onTime / timed.length : null,
    meanAbsOffsetMs: offsets.length ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length) : null,
    strumConsistency: strum?.evaluated && strum.stdOffsetMs !== null ? strum.stdOffsetMs : null,
    tempoDriftPct: tempo?.driftPct ?? null,
  };
}

/** Transitions (previous chord → this chord) that went wrong most often, from real results only. */
export function difficultTransitions(results: ChordResult[], minAttempts = 2): Array<{ from: string; to: string; attempts: number; problems: number }> {
  const sorted = [...results].sort((a, b) => a.index - b.index);
  const map = new Map<string, { from: string; to: string; attempts: number; problems: number }>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.expected === cur.expected) continue;
    const judged = cur.verdict === "correct" || cur.verdict === "wrong" || cur.verdict === "missed";
    const timed = cur.timing === "on-time" || cur.timing === "late" || cur.timing === "early" || cur.timing === "missed";
    if (!judged && !timed) continue;
    const key = `${prev.expected}→${cur.expected}`;
    const e = map.get(key) ?? { from: prev.expected, to: cur.expected, attempts: 0, problems: 0 };
    e.attempts++;
    if (cur.verdict === "wrong" || cur.verdict === "missed" || cur.timing === "late" || cur.timing === "missed") e.problems++;
    map.set(key, e);
  }
  return [...map.values()].filter((e) => e.attempts >= minAttempts && e.problems > 0).sort((a, b) => b.problems / b.attempts - a.problems / a.attempts || b.attempts - a.attempts);
}
