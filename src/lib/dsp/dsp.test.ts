/**
 * DSP tests on SYNTHETIC signals (Karplus–Strong plucked strings and sine
 * waves). They show the algorithms behave on guitar-like input; they are not
 * evidence of accuracy on a real guitar through a real microphone.
 */
import { describe, expect, it } from "vitest";
import { magnitudeSpectrum } from "./fft";
import { chromaFromSpectrum, isTonal } from "./chroma";
import { expectedTemplates, judgeFrame, rankChords } from "./chordTemplates";
import { addNoise, rng, sine, strum } from "./synth";
import { detectOnsets } from "./onset";
import { centsOff, nearestString, yin } from "./pitch";
import { estimateTempo } from "./tempo";
import { chordsCompatible, transposeChord } from "../music/chords";
import { shapeForChord, shapeToMidi, type Frets } from "../music/shapes";
import { pluck, midiToHz } from "./synth";

const SR = 48000;
const N = 8192;

function chromaOfChord(frets: Frets, opts: { capo?: number; noise?: number; at?: number; seed?: number } = {}) {
  const buf = new Float32Array(SR * 2);
  strum(buf, SR, 0.05, frets, { capo: opts.capo, seed: opts.seed ?? 11 });
  if (opts.noise) addNoise(buf, opts.noise, opts.seed ?? 5);
  const start = Math.round((opts.at ?? 0.35) * SR);
  const mag = magnitudeSpectrum(buf.subarray(start, start + N), N);
  return chromaFromSpectrum(mag, { sampleRate: SR, fftSize: N });
}

const COMMON = ["G", "C", "D", "Em", "Am", "E", "A", "Dm", "F"];

describe("chord recognition (synthetic strums)", () => {
  it.each(COMMON)("identifies %s", (name) => {
    const f = chromaOfChord(shapeForChord(name)!);
    const top = rankChords(f.chroma, f.bassPc)[0];
    expect(chordsCompatible(name, top.symbol), `${name} → ${top.symbol}`).toBe(true);
  });

  it("works with a capo (expected chord transposed to sounding pitch)", () => {
    const f = chromaOfChord(shapeForChord("G")!, { capo: 2 });
    const top = rankChords(f.chroma, f.bassPc)[0];
    expect(chordsCompatible("A", top.symbol)).toBe(true);
    expect(transposeChord(top.symbol, -2)).toMatch(/^G/);
  });

  it("matches the sheet's unusual voicings when given as expected chords", () => {
    // Em played as 022033 (Em7) and C as x32033 (Cadd9).
    for (const [name, frets] of [
      ["Em", [0, 2, 2, 0, 3, 3]],
      ["C", [null, 3, 2, 0, 3, 3]],
      ["G", [3, null, 0, 0, 3, 3]],
    ] as Array<[string, Frets]>) {
      const f = chromaOfChord(frets);
      const j = judgeFrame(f.chroma, name, expectedTemplates(name, shapeToMidi(frets)), f.bassPc);
      expect(j.verdict, name).toBe("match");
    }
  });

  it("flags a clearly different chord as a mismatch", () => {
    const pairs: Array<[string, string]> = [
      ["G", "D"],
      ["C", "Em"],
      ["Am", "E"],
      ["D", "C"],
    ];
    for (const [expected, played] of pairs) {
      const f = chromaOfChord(shapeForChord(played)!);
      const j = judgeFrame(f.chroma, expected, expectedTemplates(expected), f.bassPc);
      expect(j.verdict, `${expected} vs played ${played}`).toBe("mismatch");
      expect(chordsCompatible(played, j.competitor!.symbol), `${played} → ${j.competitor!.symbol}`).toBe(true);
    }
  });

  it("does not claim a mismatch from noise alone", () => {
    const buf = new Float32Array(N);
    addNoise(buf, 0.05, 9);
    const mag = magnitudeSpectrum(buf, N);
    const f = chromaFromSpectrum(mag, { sampleRate: SR, fftSize: N });
    expect(isTonal(f)).toBe(false);
    // Strummed chords pass the same gate.
    expect(isTonal(chromaOfChord(shapeForChord("G")!))).toBe(true);
    expect(isTonal(chromaOfChord(shapeForChord("Am")!, { noise: 0.01 }))).toBe(true);
  });

  it("stays correct with moderate background noise", () => {
    let ok = 0;
    for (const name of COMMON) {
      const f = chromaOfChord(shapeForChord(name)!, { noise: 0.01 });
      if (chordsCompatible(name, rankChords(f.chroma, f.bassPc)[0].symbol)) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(8);
  });
});

describe("onset detection (synthetic strums)", () => {
  it("finds strums within 20 ms", () => {
    const times = [0.5, 1.0, 1.5, 1.75, 2.0, 2.5, 3.1];
    const buf = new Float32Array(SR * 4);
    const g = shapeForChord("G")!;
    times.forEach((t, i) => strum(buf, SR, t, g, { direction: i % 2 ? "up" : "down", spreadMs: 8, seed: i + 1, maxSec: 1 }));
    addNoise(buf, 0.002, 4);
    const onsets = detectOnsets(buf, SR);
    expect(onsets.length).toBe(times.length);
    onsets.forEach((o, i) => expect(Math.abs(o.time - times[i]), `onset ${i}`).toBeLessThan(0.02));
  });

  it("ignores silence and steady tones", () => {
    expect(detectOnsets(new Float32Array(SR), SR)).toHaveLength(0);
    const tone = sine(SR, 220, 2, 0.3);
    expect(detectOnsets(tone, SR).length).toBeLessThanOrEqual(1);
  });
});

describe("tuner pitch detection", () => {
  it.each([
    ["E2", 40],
    ["A2", 45],
    ["D3", 50],
    ["G3", 55],
    ["B3", 59],
    ["E4", 64],
  ])("detects %s on a plucked string within 5 cents", (name, midi) => {
    const buf = new Float32Array(SR);
    pluck(buf, SR, 0, midiToHz(midi), { random: rng(midi), amp: 0.5 });
    const p = yin(buf.subarray(4800, 4800 + 4096), SR)!;
    expect(p).not.toBeNull();
    const s = nearestString(p.freq);
    expect(s.string.name).toBe(name);
    // Integer-length delay lines detune the synthetic string itself by up to ~4 cents.
    expect(Math.abs(centsOff(p.freq, midiToHz(midi)))).toBeLessThan(5);
    expect(p.confidence).toBeGreaterThan(0.8);
  });

  it("reports cents for a detuned sine", () => {
    const f = 110 * Math.pow(2, 15 / 1200);
    const p = yin(sine(SR, f, 0.2), SR)!;
    expect(nearestString(p.freq).cents).toBeCloseTo(15, 0);
  });

  it("returns nothing for noise", () => {
    const buf = new Float32Array(4096);
    addNoise(buf, 0.3, 2);
    expect(yin(buf, SR)).toBeNull();
  });
});

describe("tempo estimation", () => {
  const grid = (bpm: number, n: number, jitter = 0, seed = 1) => {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => 1 + (i * 60) / bpm + (r() - 0.5) * 2 * jitter);
  };

  it("refuses with too few onsets", () => {
    expect(estimateTempo(grid(100, 2))).toBeNull();
    expect(estimateTempo(grid(100, 6))).toBeNull();
  });

  it("estimates steady tempo with human jitter", () => {
    const e = estimateTempo(grid(96, 16, 0.015))!;
    expect(e.bpm).toBeGreaterThan(94);
    expect(e.bpm).toBeLessThan(98);
    expect(e.confidence).toBeGreaterThan(0.8);
  });

  it("uses the target to pick between half and double tempo", () => {
    const eighths = grid(180, 20, 0.005); // eighth notes at 90 BPM
    expect(estimateTempo(eighths, { targetBpm: 90 })!.bpm).toBeCloseTo(90, 0);
  });

  it("measures drift", () => {
    const steady = estimateTempo(grid(100, 16, 0.002))!;
    const shaky = estimateTempo(grid(100, 16, 0.04, 7))!;
    expect(shaky.driftPct).toBeGreaterThan(steady.driftPct);
  });
});
