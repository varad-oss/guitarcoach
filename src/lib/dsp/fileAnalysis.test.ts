/** Synthetic-recording tests (Karplus–Strong strums on a known grid). */
import { describe, expect, it } from "vitest";
import { alignSheetToBeats, analyseRecording } from "./fileAnalysis";
import { addNoise, normalise, strum } from "./synth";
import { shapeForChord } from "../music/shapes";
import { chordsCompatible } from "../music/chords";

const SR = 22050;

/** Builds a strummed progression: one chord per bar, quarter-note strums with an accented downbeat. */
function makeSong(progression: string[], bpm: number, opts: { lead?: number; repeats?: number } = {}) {
  const lead = opts.lead ?? 0.6;
  const spb = 60 / bpm;
  const bars = progression.length * (opts.repeats ?? 3);
  const buf = new Float32Array(Math.ceil((lead + bars * 4 * spb + 2) * SR));
  for (let bar = 0; bar < bars; bar++) {
    const chord = progression[bar % progression.length];
    for (let beat = 0; beat < 4; beat++) {
      const t = lead + (bar * 4 + beat) * spb;
      strum(buf, SR, t, shapeForChord(chord)!, { amp: beat === 0 ? 0.32 : 0.2, seed: bar * 4 + beat + 1, maxSec: 1.5, direction: beat % 2 ? "up" : "down" });
    }
  }
  addNoise(buf, 0.002);
  normalise(buf);
  return { buf, lead, spb };
}

describe("analyseRecording (synthetic)", () => {
  const prog = ["G", "Em", "C", "D"];
  const bpm = 92;
  const { buf, lead, spb } = makeSong(prog, bpm);
  const a = analyseRecording(buf, SR, { beatsPerBar: 4, targetBpm: null });

  it("estimates tempo within 3%", () => {
    expect(a.bpm).not.toBeNull();
    expect(Math.abs(a.bpm! - bpm) / bpm).toBeLessThan(0.03);
  });

  it("places beats on the strums", () => {
    const expected = Array.from({ length: 30 }, (_, i) => lead + i * spb);
    const errs = expected.map((t) => Math.min(...a.beatTimes.map((b) => Math.abs(b - t))));
    errs.sort((x, y) => x - y);
    expect(errs[Math.floor(errs.length * 0.8)]).toBeLessThan(0.05);
  });

  it("finds the chord progression", () => {
    const labelled = a.segments.filter((s) => s.chord);
    const seq = labelled.map((s) => s.chord!);
    // Every bar's chord should appear, in order, among the estimated segments.
    let matched = 0;
    for (let i = 0; i < 12; i++) {
      const want = prog[i % 4];
      const seg = labelled.find((s) => s.start <= lead + (i * 4 + 2) * spb && s.end > lead + (i * 4 + 2) * spb);
      if (seg && chordsCompatible(want, seg.chord!)) matched++;
    }
    expect(matched, seq.join(" ")).toBeGreaterThanOrEqual(10);
  });

  it("aligns a chord sheet that starts a few bars into the recording", () => {
    // Sheet covers only the second pass of the progression.
    const events = prog.map((chord, i) => ({ chord, startBeat: i * 4, beats: 4 }));
    const r = alignSheetToBeats(events, a.beatChroma, a.beatTonal)!;
    expect(r).not.toBeNull();
    const t = a.beatTimes[r.startBeat];
    // Any repetition of the progression is a valid match (it repeats every 4 bars).
    const barIndex = Math.round((t - lead) / (4 * spb));
    expect(Math.abs(t - (lead + barIndex * 4 * spb))).toBeLessThan(0.08);
    expect(barIndex % 4).toBe(0);
  });
});
