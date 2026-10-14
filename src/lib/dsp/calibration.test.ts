/** Synthetic tests (Karplus–Strong strums); real calibration happens with the player's own guitar. */
import { describe, expect, it } from "vitest";
import { buildProfile, checkTake, evaluateCalibration, type CalibrationTake } from "./calibration";
import { magnitudeSpectrum } from "./fft";
import { chromaFromSpectrum, isTonal } from "./chroma";
import { pluck, midiToHz, rng, strum } from "./synth";
import { shapeForChord } from "../music/shapes";
import { judgeFrame, expectedTemplates, personalTemplate } from "./chordTemplates";

const SR = 48000;
const N = 8192;

/** Strums a chord; `resonance` adds a ringing body/room note (a MIDI pitch) to mimic an unusual guitar or room. */
function takeOf(chord: string, seed: number, resonance?: number): CalibrationTake {
  const buf = new Float32Array(SR * 3);
  strum(buf, SR, 0.05, shapeForChord(chord)!, { seed });
  if (resonance !== undefined) pluck(buf, SR, Math.round(0.05 * SR), midiToHz(resonance), { amp: 0.9, random: rng(seed + 99), decay: 0.9995 });
  const frames = [];
  for (let s = Math.round(0.2 * SR); s + N <= buf.length; s += 2048) {
    const c = chromaFromSpectrum(magnitudeSpectrum(buf.subarray(s, s + N), N), { sampleRate: SR, fftSize: N });
    if (isTonal(c)) frames.push({ chroma: Array.from(c.chroma), bassPc: c.bassPc });
  }
  return { id: `${chord}-${seed}`, chord, frames, createdAt: "" };
}

const CHORDS = ["G", "C", "D", "Em", "Am"];

describe("personal calibration", () => {
  it("learns a resonant guitar/room and judges it better than the generic templates", () => {
    // A strong ringing F# (MIDI 66) in every take, e.g. a body or room resonance.
    const takes = CHORDS.flatMap((c, i) => [takeOf(c, 10 + i, 66), takeOf(c, 30 + i, 66)]);
    const reports = evaluateCalibration(takes);
    const avg = (f: (r: (typeof reports)[number]) => number) => reports.reduce((a, r) => a + f(r), 0) / reports.length;
    const genericMatch = avg((r) => r.generic.match);
    const personalMatch = avg((r) => r.personal!.match);
    const genericWrong = avg((r) => r.generic.mismatch);
    const personalWrong = avg((r) => r.personal!.mismatch);
    console.log(`RESONANT generic match ${genericMatch.toFixed(2)} wrong ${genericWrong.toFixed(2)} | personal match ${personalMatch.toFixed(2)} wrong ${personalWrong.toFixed(2)}`);
    expect(personalMatch).toBeGreaterThan(genericMatch);
    expect(personalWrong).toBeLessThanOrEqual(genericWrong);
    expect(personalMatch).toBeGreaterThan(0.75);
    expect(personalWrong).toBeLessThan(0.15);
  });

  it("does not make clean playing worse", () => {
    const takes = CHORDS.flatMap((c, i) => [takeOf(c, 50 + i), takeOf(c, 70 + i)]);
    for (const r of evaluateCalibration(takes)) {
      expect(r.personal!.mismatch, r.chord).toBeLessThanOrEqual(r.generic.mismatch + 0.05);
      expect(r.personal!.match, r.chord).toBeGreaterThanOrEqual(r.generic.match - 0.05);
    }
  });

  it("still tells different chords apart (no bias towards the expected chord)", () => {
    const profile = buildProfile(CHORDS.flatMap((c, i) => [takeOf(c, 90 + i)]));
    const played = takeOf("D", 123);
    const mism = played.frames.filter((f) => judgeFrame(f.chroma, "G", expectedTemplates("G"), f.bassPc, profile).verdict === "mismatch").length;
    expect(mism / played.frames.length).toBeGreaterThan(0.6);
  });

  it("generalises a learned chord type to unrecorded chords", () => {
    const profile = buildProfile([takeOf("G", 1), takeOf("C", 2), takeOf("Em", 3)])!;
    expect(personalTemplate("A", profile)).not.toBeNull(); // major learned from G and C
    expect(personalTemplate("Bm", profile)).not.toBeNull(); // minor learned from Em
    expect(personalTemplate("D7", profile)).toBeNull(); // no 7th chords recorded
    const a = takeOf("A", 77);
    const ok = a.frames.filter((f) => judgeFrame(f.chroma, "A", expectedTemplates("A"), f.bassPc, profile).verdict === "match").length;
    expect(ok / a.frames.length).toBeGreaterThan(0.8);
  });

  it("flags a take that clearly sounds like another chord", () => {
    const wrongLabel = { ...takeOf("D", 5), chord: "G" };
    expect(checkTake(wrongLabel.chord, wrongLabel.frames)).toEqual({ ok: false, heard: expect.stringMatching(/^D/) });
    const right = takeOf("G", 6);
    expect(checkTake("G", right.frames)).toEqual({ ok: true });
  });
});
