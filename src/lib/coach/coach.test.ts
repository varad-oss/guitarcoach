import { describe, expect, it } from "vitest";
import { evaluateChords, evaluateStrums, expectedStrums, summarize, difficultTransitions, timingVerdict, type ExpectedEvent, type SongFrame } from "./evaluate";
import { ChordTracker } from "./chordTracker";
import { TransitionTracker } from "./transitions";
import { parsePattern, slotLabels } from "./strum";
import { magnitudeSpectrum } from "../dsp/fft";
import { chromaFromSpectrum, isTonal } from "../dsp/chroma";
import { strum } from "../dsp/synth";
import { shapeForChord } from "../music/shapes";

const SR = 48000;
const N = 8192;
const HOP = 2048;

/** Analyse a synthetic buffer into frames like the live worker does. */
function framesOf(buf: Float32Array): SongFrame[] {
  const out: SongFrame[] = [];
  for (let s = 0; s + N <= buf.length; s += HOP) {
    const frame = buf.subarray(s, s + N);
    let e = 0;
    for (const x of frame) e += x * x;
    const rmsDb = 20 * Math.log10(Math.sqrt(e / N) + 1e-9);
    const c = chromaFromSpectrum(magnitudeSpectrum(frame, N), { sampleRate: SR, fftSize: N });
    const t = (s + N) / SR; // a frame is reported when its last sample arrives
    out.push({ time: t, songTime: t - N / SR / 2, rmsDb, tonal: isTonal(c), chroma: c.chroma, bassPc: c.bassPc });
  }
  return out;
}

const ev = (i: number, chord: string, start: number, end: number): ExpectedEvent => ({
  key: `k${i}`,
  index: i,
  chord,
  sectionName: "Verse",
  sectionIndex: 0,
  lineIndex: 0,
  start,
  end,
});

describe("evaluateChords (synthetic performance)", () => {
  const buf = new Float32Array(SR * 9);
  // Played: G (on time), C instead of Em (wrong), D 90 ms late, then silence where G is expected.
  strum(buf, SR, 0.0, shapeForChord("G")!, { seed: 1, maxSec: 2 });
  strum(buf, SR, 2.0, shapeForChord("C")!, { seed: 2, maxSec: 2 });
  strum(buf, SR, 4.09, shapeForChord("D")!, { seed: 3, maxSec: 1.9 });
  const frames = framesOf(buf);
  const events = [ev(0, "G", 0, 2), ev(1, "Em", 2, 4), ev(2, "D", 4, 6), ev(3, "G", 6.2, 8.2)];
  const onsets = [0.004, 2.002, 4.09];
  const results = evaluateChords(events, frames, onsets, { capo: 0, onTimeMs: 60, windowMs: 350, msTiming: true });

  it("marks correct, wrong and missed chords from the audio", () => {
    expect(results.map((r) => r.verdict)).toEqual(["correct", "wrong", "correct", "missed"]);
    expect(results[1].detected).toMatch(/^C/);
  });

  it("measures change timing only where onsets exist", () => {
    expect(results[0].timing).toBe("on-time");
    expect(results[2].timing).toBe("late");
    expect(results[2].offsetMs).toBeCloseTo(90, -1);
    expect(results[3].timing).toBe("missed");
  });

  it("does not time chords when the alignment cannot support it", () => {
    const r = evaluateChords(events, frames, onsets, { capo: 0, onTimeMs: 60, windowMs: 350, msTiming: false });
    expect(r.every((x) => x.timing === "unknown")).toBe(true);
    expect(r[0].verdict).toBe("correct");
  });

  it("says uncertain, not wrong, when there is no audio at all", () => {
    const r = evaluateChords(events, [], [], { capo: 0, onTimeMs: 60, windowMs: 350, msTiming: true });
    expect(r.every((x) => x.verdict === "not-evaluated" || x.verdict === "uncertain")).toBe(true);
  });

  it("summarises accuracy excluding uncertain chords", () => {
    const s = summarize([...results, { ...results[0], key: "u", index: 9, verdict: "uncertain", timing: "unknown" }]);
    expect(s.chordEvaluated).toBe(4);
    expect(s.correct).toBe(2);
    expect(s.chordAccuracy).toBeCloseTo(0.5);
    expect(s.uncertain).toBe(1);
    // The wrong chord was still strummed on time, so three changes carry timing.
    expect(s.timingEvaluated).toBe(3);
    expect(s.onTime).toBe(2);
    expect(s.late).toBe(1);
  });

  it("handles capo: shapes are expected, sounding pitch is analysed", () => {
    const b2 = new Float32Array(SR * 3);
    strum(b2, SR, 0, shapeForChord("G")!, { capo: 2, seed: 4 });
    const r = evaluateChords([ev(0, "G", 0, 2.5)], framesOf(b2), [0], { capo: 2, onTimeMs: 60, windowMs: 350, msTiming: true });
    expect(r[0].verdict).toBe("correct");
  });
});

describe("timing verdicts", () => {
  it("classifies early / on time / late", () => {
    expect(timingVerdict(-120, 70)).toBe("early");
    expect(timingVerdict(40, 70)).toBe("on-time");
    expect(timingVerdict(85, 70)).toBe("late");
  });
});

describe("strumming", () => {
  it("parses patterns, including the ambiguous shorthand", () => {
    expect(parsePattern("D - D U - U D U", 8)).toEqual(["D", "-", "D", "U", "-", "U", "D", "U"]);
    expect(parsePattern("D D U U D U", 8)).toEqual(["D", "-", "D", "U", "-", "U", "D", "U"]);
    expect(parsePattern("DUDU", 8)).toEqual(["D", "U", "D", "U", "-", "-", "-", "-"]);
    expect(parsePattern("hello", 8)).toBeNull();
    expect(slotLabels(4, 2)).toEqual(["1", "&", "2", "&", "3", "&", "4", "&"]);
    expect(slotLabels(4, 3).slice(0, 4)).toEqual(["1", "&", "a", "2"]);
  });

  it("matches onsets to expected strums and counts misses and extras", () => {
    const beat = (b: number) => b * 0.5; // 120 BPM
    const exp = expectedStrums(["D", "-", "D", "U", "-", "U", "D", "U"], 2, beat, 4, 0, 4);
    expect(exp).toEqual([0, 0.5, 0.75, 1.25, 1.5, 1.75]);
    const onsets = [0.01, 0.52, 0.74, 1.27, 1.5, 1.1];
    const s = evaluateStrums(exp, onsets, 0.1, true);
    expect(s).toMatchObject({ evaluated: true, expected: 6, matched: 5, missed: 1, extra: 1 });
    expect(s.meanAbsOffsetMs).toBeLessThan(20);
    expect(evaluateStrums(exp, onsets, 0.1, false).evaluated).toBe(false);
  });
});

describe("difficult transitions", () => {
  it("ranks transitions by real problems only", () => {
    const mk = (i: number, expected: string, verdict: "correct" | "wrong" | "uncertain") => ({
      key: `${i}`, index: i, expected, sectionName: "", sectionIndex: 0, lineIndex: 0, expectedTime: i, verdict, timing: "unknown" as const,
    });
    const r = [mk(0, "G", "correct"), mk(1, "C", "wrong"), mk(2, "G", "correct"), mk(3, "C", "wrong"), mk(4, "D", "uncertain"), mk(5, "G", "correct")];
    const d = difficultTransitions(r);
    expect(d[0]).toMatchObject({ from: "G", to: "C", attempts: 2, problems: 2 });
    expect(d.find((x) => x.to === "D")).toBeUndefined();
  });
});

describe("live tracking", () => {
  it("smooths detections and ignores a single odd frame", () => {
    const g = new Float32Array(SR * 2);
    strum(g, SR, 0, shapeForChord("G")!, { seed: 1 });
    const d = new Float32Array(SR * 2);
    strum(d, SR, 0, shapeForChord("D")!, { seed: 2 });
    const gf = framesOf(g).slice(2, 10);
    const df = framesOf(d).slice(3, 4);
    const t = new ChordTracker();
    const seq = [...gf.slice(0, 4), df[0], ...gf.slice(4)].map((f) => t.push(f));
    const labels = seq.filter((x) => x.state === "chord").map((x) => x.chord);
    expect(labels.length).toBeGreaterThan(5);
    expect(labels.every((l) => l?.startsWith("G"))).toBe(true);
  });

  it("measures chord changes in the transition trainer", () => {
    const tr = new TransitionTracker("G", "C");
    const det = (chord: string, time: number) => ({ state: "chord" as const, chord, clarity: "high" as const, candidates: [], time });
    tr.push(det("G", 0));
    tr.push(det("G", 1));
    tr.push(det("C", 1.6));
    tr.push(det("C", 2));
    tr.push(det("Am", 2.2));
    tr.push(det("G", 3));
    const s = tr.stats();
    expect(tr.events.map((e) => [e.from, e.to, e.gapMs, e.ok])).toEqual([
      ["G", "C", 600, true],
      ["C", "G", 1000, false],
    ]);
    expect(s.successes).toBe(1);
  });
});

import { computeLatency } from "../audio/latency";

describe("latency calibration", () => {
  it("finds the median delay between clicks and strums", () => {
    const clicks = Array.from({ length: 8 }, (_, i) => 10 + i * 0.6667);
    const onsets = clicks.map((c, i) => c + 0.12 + (i % 2 ? 0.01 : -0.008));
    const r = computeLatency(clicks, onsets);
    expect("latencyMs" in r && r.latencyMs).toBeGreaterThanOrEqual(112);
    expect("latencyMs" in r && r.latencyMs).toBeLessThanOrEqual(130);
  });
  it("refuses with too few or scattered strums", () => {
    const clicks = Array.from({ length: 8 }, (_, i) => i);
    expect("error" in computeLatency(clicks, [0.1, 1.1])).toBe(true);
    const scattered = clicks.map((c, i) => c + (i % 2 ? 0.02 : 0.3));
    expect("error" in computeLatency(clicks, scattered)).toBe(true);
  });
});

import { patternForSection, slotAtBeat } from "./strum";

describe("patterns of any length and per-section patterns", () => {
  it("counts and cycles patterns shorter than a bar", () => {
    expect(slotLabels(4, 3, 6)).toEqual(["1", "&", "a", "2", "&", "a"]);
    expect(slotLabels(4, 4, 6)).toEqual(["1", "e", "&", "a", "2", "e"]);
    expect(slotAtBeat(0, 4, 6)).toBe(0);
    expect(slotAtBeat(1.5, 4, 6)).toBe(0); // 6 slots of sixteenths = 1.5 beats
    expect(slotAtBeat(1.75, 4, 6)).toBe(1);
    const exp = expectedStrums(["D", "-", "U"], 3, (b) => b, 4, 0, 2);
    expect(exp.map((x) => Math.round(x * 3))).toEqual([0, 2, 3, 5]);
  });
  it("chooses a section's own pattern, else the main pattern", () => {
    const pats = [{ name: "Main" }, { name: "Chorus alt", sectionKinds: ["chorus"] }];
    expect(patternForSection(pats, "chorus")!.name).toBe("Chorus alt");
    expect(patternForSection(pats, "verse")!.name).toBe("Main");
    expect(patternForSection([], "verse")).toBeUndefined();
  });
});
