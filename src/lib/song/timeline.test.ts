import { describe, expect, it } from "vitest";
import { parseChordSheet } from "../parse/chordSheet";
import { songFromParsed, findDuplicates, carryOverDurations } from "./build";
import { buildTimeline, eventIndexAtBeat } from "./timeline";
import { beatMapFor, eventIndexAtTime, eventTimes, fitTaps, gridBeatMap, linearBeatMap } from "./alignment";
import { createEmptySong, songFingerprint } from "./model";

const song = (text: string, ts = { numerator: 4, denominator: 4 }) => {
  const s = songFromParsed(parseChordSheet(text), { title: "T", source: { kind: "paste", importedAt: "" } });
  return { ...s, timeSignature: ts };
};

describe("buildTimeline", () => {
  it("gives one bar per chord by default and half bars to squeezed chords", () => {
    const tl = buildTimeline(song("[Verse]\nG          Em\nwords go here and here\nC          G D\nmore words for you\n"));
    expect(tl.events.map((e) => [e.chord, e.startBeat, e.beats])).toEqual([
      ["G", 0, 4],
      ["Em", 4, 4],
      ["C", 8, 4],
      ["G", 12, 2],
      ["D", 14, 2],
    ]);
    expect(tl.events.every((e) => e.estimated)).toBe(true);
    expect(tl.totalBeats).toBe(16);
  });

  it("expands line and section repeats", () => {
    const tl = buildTimeline(song("[Chorus x2]\n| G | C |  x2\n"));
    expect(tl.events.map((e) => e.chord).join(" ")).toBe("G C G C G C G C");
    expect(tl.sections).toHaveLength(2);
    expect(tl.sections[1].startBeat).toBe(16);
    expect(new Set(tl.events.map((e) => e.key)).size).toBe(8);
  });

  it("uses the meter: 12/8 has four dotted-quarter beats per bar", () => {
    const tl = buildTimeline(song("[Verse]\n| G | Em |\n", { numerator: 12, denominator: 8 }));
    expect(tl.beatsPerBar).toBe(4);
    expect(tl.events.map((e) => e.beats)).toEqual([4, 4]);
    const tl34 = buildTimeline(song("[Verse]\n| G | Em |\n", { numerator: 3, denominator: 4 }));
    expect(tl34.events.map((e) => e.startBeat)).toEqual([0, 3]);
  });

  it("skips note-only sections", () => {
    const tl = buildTimeline(song("Capo 1\nG 320003\n\n[Intro]\nG\n"));
    expect(tl.events.map((e) => e.chord)).toEqual(["G"]);
  });

  it("finds the event at a beat", () => {
    const tl = buildTimeline(song("[V]\n| G | C D |\n"));
    expect(eventIndexAtBeat(tl, -1)).toBe(-1);
    expect(eventIndexAtBeat(tl, 3.9)).toBe(0);
    expect(eventIndexAtBeat(tl, 4)).toBe(1);
    expect(eventIndexAtBeat(tl, 6.5)).toBe(2);
  });
});

describe("alignment", () => {
  it("maps beats linearly with an offset", () => {
    const m = linearBeatMap(120, 1.5);
    expect(m.beatToTime(4)).toBeCloseTo(3.5);
    expect(m.timeToBeat(3.5)).toBeCloseTo(4);
  });

  it("follows a measured beat grid and extrapolates past its ends", () => {
    const m = gridBeatMap([1, 1.5, 2.1, 2.6], 120);
    expect(m.beatToTime(2)).toBeCloseTo(2.1);
    expect(m.beatToTime(1.5)).toBeCloseTo(1.8);
    expect(m.beatToTime(4)).toBeCloseTo(3.1);
    expect(m.timeToBeat(1.8)).toBeCloseTo(1.5);
    expect(m.beatToTime(-1)).toBeCloseTo(0.5);
  });

  it("applies manual event times and keeps order", () => {
    const tl = buildTimeline(song("[V]\n| G | C | D |\n"));
    const times = eventTimes(tl, { bpm: 60, offsetSec: 2, eventTimes: { [tl.events[1].key]: 7.2 } });
    expect(times.map((t) => t.start)).toEqual([2, 7.2, 10]);
    expect(times[0].end).toBe(7.2);
    expect(times[1].manual).toBe(true);
    expect(eventIndexAtTime(times, 8)).toBe(1);
    expect(eventIndexAtTime(times, 1)).toBe(-1);
  });

  it("uses the grid when present", () => {
    const m = beatMapFor({ bpm: 100, offsetSec: 0, beatTimes: [0.4, 1.0, 1.6] });
    expect(m.beatToTime(1)).toBeCloseTo(1.0);
  });
});

describe("fitTaps", () => {
  it("recovers tempo and phase from jittery taps", () => {
    const taps = Array.from({ length: 12 }, (_, i) => 3 + i * 0.6 + (i % 2 ? 0.012 : -0.01));
    const fit = fitTaps(taps)!;
    expect(fit.bpm).toBeCloseTo(100, 0);
    expect(fit.offsetSec).toBeCloseTo(3, 1);
    expect(fit.residualMs).toBeLessThan(20);
  });

  it("tolerates a missed tap", () => {
    const taps = [0, 0.5, 1.0, 2.0, 2.5, 3.0];
    expect(fitTaps(taps)!.bpm).toBeCloseTo(120, 0);
  });

  it("refuses with too few or inconsistent taps", () => {
    expect(fitTaps([0, 0.5, 1])).toBeNull();
    expect(fitTaps([0, 0.5, 0.7, 1.9, 2.0, 3.3])).toBeNull();
  });
});

describe("duplicates and edits", () => {
  it("matches by source URL or normalised title/artist", () => {
    const lib = [
      createEmptySong({ title: "Paper Boats", artist: "The Harbour", source: { kind: "url", url: "https://www.example.com/a/b/", importedAt: "" } }),
    ];
    expect(findDuplicates({ title: "x", artist: "y", source: { kind: "url", url: "https://example.com/a/b", importedAt: "" } }, lib)[0].reason).toBe(
      "same-source",
    );
    expect(findDuplicates({ title: "paper boats (chords)", artist: "Another Band", source: { kind: "paste", importedAt: "" } }, lib)).toHaveLength(0);
    expect(findDuplicates({ title: "Paper Boats (Chords)", artist: "the harbour", source: { kind: "paste", importedAt: "" } }, lib)[0].reason).toBe(
      "same-title-artist",
    );
    expect(songFingerprint("Café Song", "Ånd")).toBe("cafe song|and");
  });

  it("keeps user chord lengths after re-parsing edited text", () => {
    const before = parseChordSheet("[V]\nG     C\nla la\n").sections;
    before[0].lines[0].chords[1].bars = 2;
    const after = carryOverDurations(before, parseChordSheet("[V]\nG     C\nla la la\n").sections);
    expect(after[0].lines[0].chords[1].bars).toBe(2);
  });
});
