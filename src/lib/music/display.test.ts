import { describe, expect, it } from "vitest";
import { applyDisplay, chordMapper, pitchOffset, shownKey, simplifyChord, soundingKey } from "./display";
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
