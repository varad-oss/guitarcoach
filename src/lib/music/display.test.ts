import { describe, expect, it } from "vitest";
import { applyDisplay, chordMapper, easiestShapes, pitchOffset, shownKey, simplifyChord, soundingKey } from "./display";
import { createEmptySong, DEFAULT_DISPLAY } from "../song/model";
import { parseChordSheet } from "../parse/chordSheet";

const song = () =>
  createEmptySong({
    key: "Ab",
    capo: 1,
    sections: parseChordSheet("[Verse]\nG    Em7    Cadd9    D/F#\nwords here and there\n").sections,
    chordShapes: { G: { frets: [3, null, 0, 0, 3, 3], source: "sheet" }, Em7: { frets: [0, 2, 2, 0, 3, 3], source: "sheet" } },
  });

describe("display transforms", () => {
  it("simplifies chords to basic triads", () => {
    expect(["Cadd9", "Em7", "D/F#", "Dsus4", "Gmaj7", "A7", "Bm7b5", "E5", "F#m"].map(simplifyChord)).toEqual(["C", "Em", "D", "D", "G", "A", "Bdim", "E", "F#m"]);
  });

  it("knows the shape key and the sounding key (UG lists the sounding key)", () => {
    const s = song();
    expect(shownKey(s, DEFAULT_DISPLAY)).toBe("G");
    expect(soundingKey(s, DEFAULT_DISPLAY)).toBe("Ab");
    // "For the original key without a capo, transpose +1": same sound.
    const noCapo = { ...DEFAULT_DISPLAY, transpose: 1, capo: 0 };
    expect(pitchOffset(s, noCapo)).toBe(0);
    expect(shownKey(s, noCapo)).toBe("Ab");
    expect(chordMapper(s, noCapo)("D/F#")).toBe("Eb/G");
    expect(soundingKey(s, { ...DEFAULT_DISPLAY, transpose: 2 })).toBe("Bb");
  });

  it("produces a playable song: mapped chords, new capo, only still-valid voicings", () => {
    const s = song();
    const simple = applyDisplay(s, { ...DEFAULT_DISPLAY, simplify: true });
    expect(simple.sections[0].lines[0].chords.map((c) => c.chord)).toEqual(["G", "Em", "C", "D"]);
    expect(Object.keys(simple.chordShapes)).toEqual(["G"]);
    const t = applyDisplay(s, { ...DEFAULT_DISPLAY, transpose: 1, capo: 0 });
    expect(t.capo).toBe(0);
    expect(t.sections[0].lines[0].chords.map((c) => c.chord)).toEqual(["Ab", "Fm7", "Dbadd9", "Eb/G"]);
    expect(t.chordShapes).toEqual({});
    expect(applyDisplay(s, DEFAULT_DISPLAY)).toBe(s);
    expect(s.sections[0].lines[0].chords[0].chord).toBe("G");
  });
});

describe("easiestShapes", () => {
  const songOf = (chords: string[], capo = 0, key?: string) => ({
    key,
    capo,
    sections: [{ lines: [{ chords: chords.map((chord) => ({ chord })) }] }],
  }) as unknown as Parameters<typeof easiestShapes>[0];

  it("finds capo 1 with G-family shapes for a song written in Ab", () => {
    const r = easiestShapes(songOf(["Ab", "Fm", "Db", "Eb", "Ab", "Fm", "Db", "Eb"], 0, "Ab"))!;
    expect(r).toMatchObject({ capo: 1, transpose: -1 });
    expect(new Set(r.chords)).toEqual(new Set(["G", "Em", "C", "D"]));
    expect(r.openShare).toBe(1);
  });

  it("keeps the song sounding the same", () => {
    const song = songOf(["Bb", "Gm", "Eb", "F"], 0, "Bb");
    const r = easiestShapes(song)!;
    expect(pitchOffset(song as never, { ...DEFAULT_DISPLAY, capo: r.capo, transpose: r.transpose, simplify: true })).toBe(0);
    expect(r.openShare).toBe(1);
  });

  it("leaves an already-easy song alone", () => {
    expect(easiestShapes(songOf(["G", "D", "Em", "C"]))).toMatchObject({ capo: 0, transpose: 0, openShare: 1 });
  });

  it("respects a written capo (UG: key Ab, capo 1, G shapes)", () => {
    expect(easiestShapes(songOf(["G", "Em", "C", "D"], 1, "Ab"))).toMatchObject({ capo: 1, transpose: 0 });
  });

  it("simplifies extended chords first", () => {
    const r = easiestShapes(songOf(["Cadd9", "D/F#", "Em7", "Gsus4"]))!;
    expect(r.capo).toBe(0);
    expect(new Set(r.chords)).toEqual(new Set(["C", "D", "Em", "G"]));
  });

  it("returns null when there are no chords", () => {
    expect(easiestShapes(songOf([]))).toBeNull();
  });
});
