import { describe, expect, it } from "vitest";
import { layoutFragments } from "./layoutText";
import { parseChordSheet } from "../parse/chordSheet";

describe("layoutFragments", () => {
  it("rebuilds chord columns from positioned fragments (PDF coordinates)", () => {
    const cw = 6;
    const items = [
      { text: "[Verse]", x: 50, y: 700, width: 7 * cw, height: 10 },
      { text: "G", x: 50 + 6 * cw, y: 686, width: cw, height: 10 },
      { text: "Em", x: 50 + 19 * cw, y: 686, width: 2 * cw, height: 10 },
      { text: "Under the lamplight we wait", x: 50, y: 672, width: 27 * cw, height: 10 },
    ];
    const text = layoutFragments(items, { topDown: false });
    expect(text).toBe("[Verse]\n      G            Em\nUnder the lamplight we wait");
    const r = parseChordSheet(text);
    expect(r.sections[0].lines[0].chords.map((c) => [c.chord, c.charIndex])).toEqual([
      ["G", 6],
      ["Em", 19],
    ]);
  });

  it("inserts blank lines at large vertical gaps (OCR coordinates)", () => {
    const text = layoutFragments(
      [
        { text: "one", x: 0, y: 0, width: 30, height: 10 },
        { text: "two", x: 0, y: 60, width: 30, height: 10 },
      ],
      { topDown: true },
    );
    expect(text).toBe("one\n\ntwo");
  });
});
