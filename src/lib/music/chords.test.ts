import { describe, expect, it } from "vitest";
import { chordsCompatible, isChord, keyPrefersFlats, normaliseChord, parseChord, transposeChord } from "./chords";
import { meterInfo, parseTimeSignature } from "./meter";
import { parseFretString, shapeForChord, shapeToMidi } from "./shapes";

const pcs = (s: string) => parseChord(s)?.pcs;

describe("parseChord", () => {
  it.each([
    ["G", [2, 7, 11], "maj"],
    ["Em", [4, 7, 11], "min"],
    ["C", [0, 4, 7], "maj"],
    ["D7", [0, 2, 6, 9], "maj"],
    ["Am7", [0, 4, 7, 9], "min"],
    ["Cmaj7", [0, 4, 7, 11], "maj"],
    ["Dsus4", [2, 7, 9], "sus4"],
    ["Asus2", [4, 9, 11], "sus2"],
    ["Bdim", [2, 5, 11], "dim"],
    ["Caug", [0, 4, 8], "aug"],
    ["E5", [4, 11], "5"],
    ["Cadd9", [0, 2, 4, 7], "maj"],
    ["F#m7b5", [0, 4, 6, 9], "dim"],
  ])("%s", (sym, expected, family) => {
    const c = parseChord(sym)!;
    expect(c).not.toBeNull();
    expect(c.pcs).toEqual(expected);
    expect(c.family).toBe(family);
  });

  it("parses slash chords with alternate bass", () => {
    const c = parseChord("D/F#")!;
    expect(c.root).toBe(2);
    expect(c.bass).toBe(6);
    expect(c.symbol).toBe("D/F#");
    expect(c.pcs).toEqual([2, 6, 9]);
    expect(parseChord("G/B")!.bass).toBe(11);
    expect(parseChord("Am/G")!.pcs).toEqual([0, 4, 7, 9]);
  });

  it("normalises synonyms and unicode", () => {
    expect(normaliseChord("Cmin7")).toBe("Cm7");
    expect(normaliseChord("C-7")).toBe("Cm7");
    expect(normaliseChord("CΔ7")).toBe("Cmaj7");
    expect(normaliseChord("CM7")).toBe("Cmaj7");
    expect(normaliseChord("B♭")).toBe("Bb");
    expect(normaliseChord("F♯m")).toBe("F#m");
    expect(normaliseChord("Bø")).toBe("Bm7b5");
    expect(normaliseChord("C(add9)")).toBe("Cadd9");
    expect(normaliseChord("Bo7")).toBe("Bdim7");
    expect(normaliseChord("Dsus")).toBe("Dsus");
  });

  it("handles extensions and alterations", () => {
    expect(pcs("G9")).toEqual([2, 5, 7, 9, 11]);
    expect(pcs("C6/9")).toEqual([0, 2, 4, 7, 9]);
    expect(pcs("E7#9")).toEqual([2, 4, 7, 8, 11]);
    expect(parseChord("A7sus4")!.family).toBe("sus4");
    expect(parseChord("Cmmaj7")!.pcs).toEqual([0, 3, 7, 11]);
  });

  it("rejects ordinary words", () => {
    for (const w of ["I", "Bad", "Add", "Be", "Go", "Do", "Hello", "Ebony", "Cause", "Ah", "x2", "%", "|", "N.C."]) {
      expect(isChord(w), w).toBe(false);
    }
  });
});

describe("transposeChord", () => {
  it("transposes roots and bass notes", () => {
    expect(transposeChord("G", 2)).toBe("A");
    expect(transposeChord("Em7", 1)).toBe("Fm7");
    expect(transposeChord("D/F#", 2)).toBe("E/G#");
    expect(transposeChord("Bb", 2)).toBe("C");
    expect(transposeChord("Eb", 1)).toBe("E");
    expect(transposeChord("G", 1, true)).toBe("Ab");
  });
});

describe("chordsCompatible", () => {
  it("accepts colour tones, inversions and power chords of the same chord", () => {
    expect(chordsCompatible("C", "Cadd9")).toBe(true);
    expect(chordsCompatible("Em", "Em7")).toBe(true);
    expect(chordsCompatible("D", "D/F#")).toBe(true);
    expect(chordsCompatible("G", "G5")).toBe(true);
  });
  it("rejects different roots or families", () => {
    expect(chordsCompatible("G", "Em")).toBe(false);
    expect(chordsCompatible("C", "Cm")).toBe(false);
    expect(chordsCompatible("D", "Dsus4")).toBe(false);
  });
});

describe("keys", () => {
  it("knows which keys use flats", () => {
    expect(keyPrefersFlats("F")).toBe(true);
    expect(keyPrefersFlats("Ab")).toBe(true);
    expect(keyPrefersFlats("G")).toBe(false);
    expect(keyPrefersFlats("Dm")).toBe(true);
    expect(keyPrefersFlats("Em")).toBe(false);
  });
});

describe("meter", () => {
  it("treats 12/8 and 6/8 as compound", () => {
    expect(meterInfo({ numerator: 12, denominator: 8 })).toMatchObject({ beatsPerBar: 4, subdivisionsPerBeat: 3, isCompound: true });
    expect(meterInfo({ numerator: 6, denominator: 8 })).toMatchObject({ beatsPerBar: 2, subdivisionsPerBeat: 3 });
    expect(meterInfo({ numerator: 3, denominator: 4 })).toMatchObject({ beatsPerBar: 3, subdivisionsPerBeat: 2, isCompound: false });
    expect(meterInfo({ numerator: 7, denominator: 8 })).toMatchObject({ beatsPerBar: 7, subdivisionsPerBeat: 1 });
  });
  it("parses time signatures", () => {
    expect(parseTimeSignature("12/8")).toEqual({ numerator: 12, denominator: 8 });
    expect(parseTimeSignature("4/3")).toBeNull();
  });
});

describe("shapes", () => {
  it("parses fret strings in common formats", () => {
    expect(parseFretString("x32010")).toEqual([null, 3, 2, 0, 1, 0]);
    // "(3)" marks an optional note on the 6th string, as on many chord sheets.
    expect(parseFretString("3-x-0-0-3(3)")).toEqual([3, null, 0, 0, 3, 3]);
    expect(parseFretString("x-3-2-0-1-0")).toEqual([null, 3, 2, 0, 1, 0]);
    expect(parseFretString("x x 10 9 8 x")).toEqual([null, null, 10, 9, 8, null]);
    expect(parseFretString("hello")).toBeNull();
  });
  it("finds open and barre shapes", () => {
    expect(shapeForChord("G")).toEqual([3, 2, 0, 0, 0, 3]);
    expect(shapeForChord("Bb")).toEqual([null, 1, 3, 3, 3, 1]);
    expect(shapeForChord("F#m")).toEqual([2, 4, 4, 2, 2, 2]);
  });
  it("converts shapes to sounding notes with capo", () => {
    expect(shapeToMidi([null, 3, 2, 0, 1, 0], 0)).toEqual([48, 52, 55, 60, 64]);
    expect(shapeToMidi([null, 3, 2, 0, 1, 0], 2)).toEqual([50, 54, 57, 62, 66]);
  });
});
