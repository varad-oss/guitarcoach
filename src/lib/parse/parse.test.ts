// All lyrics in these fixtures are invented for testing.
import { describe, expect, it } from "vitest";
import { detectFormat, parseSongText } from "./index";
import { parseChordSheet } from "./chordSheet";
import { parseChordPro } from "./chordpro";
import { sectionsToText, songToChordPro } from "./serialize";
import { songFromParsed } from "../song/build";

const SHEET = `Capo: 2nd fret
Key: G
Tempo: 72

G      3-x-0-0-3(3)
Em     0-2-2-0-3-3

[Intro]
G   D   Em   C

[Verse 1]
       G            Em
Paper boats on a silver stream
        C                   D
Carry all the words we never said
G        D/F#      Em
Lanterns hum along the harbour

[Chorus]
   C        G/B     Am7      Dsus4  D
Hold on, the morning's almost here
| G | % | C D | Em |  x2
`;

describe("parseChordSheet: chords over lyrics", () => {
  const r = parseChordSheet(SHEET);

  it("extracts metadata lines", () => {
    expect(r.capo).toBe(2);
    expect(r.key).toBe("G");
    expect(r.bpm).toBe(72);
  });

  it("reads chord shape definitions instead of treating them as chords", () => {
    expect(r.chordShapes.G.frets).toEqual([3, null, 0, 0, 3, 3]);
    expect(r.chordShapes.Em.frets).toEqual([0, 2, 2, 0, 3, 3]);
  });

  it("finds sections in order", () => {
    const named = r.sections.filter((s) => s.kind !== "notes").map((s) => [s.name, s.kind]);
    expect(named).toEqual([
      ["Intro", "intro"],
      ["Verse 1", "verse"],
      ["Chorus", "chorus"],
    ]);
    expect(r.sections[0].kind).toBe("notes");
  });

  it("keeps chord positions relative to lyrics", () => {
    const verse = r.sections.find((s) => s.name === "Verse 1")!;
    const first = verse.lines[0];
    expect(first.kind).toBe("lyric");
    expect(first.lyrics).toBe("Paper boats on a silver stream");
    expect(first.chords.map((c) => [c.chord, c.charIndex])).toEqual([
      ["G", 7],
      ["Em", 20],
    ]);
    // "G" sits above the "o" of "boats"
    expect(first.lyrics.slice(first.chords[0].charIndex)).toMatch(/^oats on/);
  });

  it("parses slash, suspended and seventh chords", () => {
    const chorus = r.sections.find((s) => s.name === "Chorus")!;
    expect(chorus.lines[0].chords.map((c) => c.chord)).toEqual(["C", "G/B", "Am7", "Dsus4", "D"]);
  });

  it("expands % bar repeats and reads bar lengths and repeat counts", () => {
    const chorus = r.sections.find((s) => s.name === "Chorus")!;
    const bars = chorus.lines[1];
    expect(bars.kind).toBe("chords");
    expect(bars.repeat).toBe(2);
    expect(bars.chords.map((c) => [c.chord, c.bars])).toEqual([
      ["G", 1],
      ["G", 1],
      ["C", 0.5],
      ["D", 0.5],
      ["Em", 1],
    ]);
  });

  it("reports good confidence for a clean sheet", () => {
    expect(r.confidence).toBeGreaterThan(0.85);
    expect(r.stats.chordEvents).toBe(4 + 2 + 2 + 3 + 5 + 5);
  });
});

describe("parseChordSheet: messy input", () => {
  it("handles tabs, CRLF and odd spacing", () => {
    const r = parseChordSheet("Verse:\r\n\tAm\t\tF\r\nRivers of chalk and ember\r\n");
    const line = r.sections[0].lines[0];
    expect(r.sections[0].name).toBe("Verse");
    expect(line.chords.map((c) => c.chord)).toEqual(["Am", "F"]);
    expect(line.chords[0].charIndex).toBe(4);
  });

  it("understands plain headings, chorus x2 and keyword-led lyrics", () => {
    const r = parseChordSheet("Chorus x2\nG C\nBridge over the hill we go\n");
    expect(r.sections[0]).toMatchObject({ name: "Chorus", repeat: 2 });
    // "Bridge over..." is a lyric, not a heading
    expect(r.sections[0].lines[0].lyrics).toBe("Bridge over the hill we go");
  });

  it("flags lines it is unsure about instead of dropping them", () => {
    const r = parseChordSheet("[Intro]\nG  C  riff  D\n");
    const line = r.sections[0].lines[0];
    expect(line.chords.map((c) => c.chord)).toEqual(["G", "C", "D"]);
    expect(line.flag).toMatch(/riff/);
    expect(r.stats.flaggedLines).toBe(1);
  });

  it("keeps tablature as tab lines", () => {
    const r = parseChordSheet("[Riff]\ne|-----0---|\nB|---1-----|\nG|-2-------|\n");
    expect(r.sections[0].lines.every((l) => l.kind === "tab")).toBe(true);
  });

  it("supports inline bracket chords inside a plain sheet", () => {
    const r = parseChordSheet("[Verse]\nThe [G]kettle sings a [C]tune\n");
    const l = r.sections[0].lines[0];
    expect(l.lyrics).toBe("The kettle sings a tune");
    expect(l.chords.map((c) => [c.chord, c.charIndex])).toEqual([
      ["G", 4],
      ["C", 19],
    ]);
  });

  it("copies a section for 'Repeat chorus'", () => {
    const r = parseChordSheet("[Chorus]\nG D\nla la\n[Verse]\nEm\nhey\nRepeat Chorus\n");
    const choruses = r.sections.filter((s) => s.kind === "chorus");
    expect(choruses).toHaveLength(2);
    expect(choruses[1].lines[0].chords.map((c) => c.chord)).toEqual(["G", "D"]);
    expect(choruses[1].lines[0].id).not.toBe(choruses[0].lines[0].id);
  });

  it("reports low confidence when no chords are found", () => {
    const r = parseChordSheet("just some words\nwith nothing else\n");
    expect(r.stats.chordEvents).toBe(0);
    expect(r.confidence).toBeLessThan(0.3);
    expect(r.warnings.join(" ")).toMatch(/No chords/);
  });

  it("reads beat slashes as chord lengths", () => {
    const r = parseChordSheet("[Intro]\nG / / / C / D /\n");
    expect(r.sections[0].lines[0].chords.map((c) => c.bars)).toEqual([1, 0.5, 0.5]);
  });
});

describe("Ultimate Guitar markup", () => {
  const UG = `[Intro]\n[ch]G[/ch]   [ch]Cadd9[/ch]\n\n[Verse 1]\n[tab]      [ch]G[/ch]          [ch]Em[/ch]\nStars fold up like paper cranes[/tab]\n[tab][ch]C[/ch]               [ch]D[/ch]\nTucked inside a coat of rain[/tab]`;

  it("is detected and parsed with chord positions", () => {
    expect(detectFormat(UG)).toBe("ug");
    const r = parseSongText(UG);
    expect(r.stats.format).toBe("ug");
    const verse = r.sections.find((s) => s.name === "Verse 1")!;
    expect(verse.lines[0].lyrics).toBe("Stars fold up like paper cranes");
    expect(verse.lines[0].chords.map((c) => [c.chord, c.charIndex])).toEqual([
      ["G", 6],
      ["Em", 17],
    ]);
    expect(r.sections[0].lines[0].chords.map((c) => c.chord)).toEqual(["G", "Cadd9"]);
  });
});

describe("ChordPro", () => {
  const CHO = `{title: Window Light}
{artist: The Example Band}
{key: D}
{capo: 1}
{tempo: 96}
{time: 6/8}
{define: Dsus2 base-fret 1 frets x x 0 2 3 0}

{start_of_verse: Verse 1}
[D]Morning on the [A]window sill
[Bm]Coffee cooling, [G]all is still
{end_of_verse}

{start_of_chorus}
[G]Sing it [D/F#]low
{end_of_chorus}

{comment: Bridge}
[Em] [A]

{chorus}
`;

  it("is detected", () => {
    expect(detectFormat(CHO)).toBe("chordpro");
  });

  it("parses metadata, sections and inline chords", () => {
    const r = parseChordPro(CHO);
    expect(r).toMatchObject({ title: "Window Light", artist: "The Example Band", key: "D", capo: 1, bpm: 96 });
    expect(r.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    expect(r.chordShapes.Dsus2.frets).toEqual([null, null, 0, 2, 3, 0]);
    const names = r.sections.map((s) => [s.name, s.kind]);
    expect(names).toEqual([
      ["Verse 1", "verse"],
      ["Chorus", "chorus"],
      ["Bridge", "bridge"],
      ["Chorus", "chorus"],
    ]);
    const l = r.sections[0].lines[0];
    expect(l.lyrics).toBe("Morning on the window sill");
    expect(l.chords.map((c) => [c.chord, c.charIndex])).toEqual([
      ["D", 0],
      ["A", 15],
    ]);
    expect(r.sections[2].lines[0].kind).toBe("chords");
    expect(r.sections[3].lines[0].chords.map((c) => c.chord)).toEqual(["G", "D/F#"]);
  });

  it("detects inline-chord text without directives", () => {
    expect(detectFormat("[G]One two [C]three\n[D]Four five [G]six\n")).toBe("chordpro");
  });
});

describe("round trips", () => {
  it("text → model → text → model preserves chords, positions and sections", () => {
    const a = parseChordSheet(SHEET);
    const text = sectionsToText(a.sections);
    const b = parseChordSheet(text);
    const shape = (r: typeof a) =>
      r.sections
        .filter((s) => s.kind !== "notes")
        .map((s) => ({ name: s.name, lines: s.lines.map((l) => ({ lyrics: l.lyrics, chords: l.chords.map((c) => [c.chord, c.charIndex, c.bars]) })) }));
    expect(shape(b)).toEqual(shape(a));
  });

  it("exports ChordPro that parses back to the same chords", () => {
    const parsed = parseChordSheet(SHEET);
    const song = songFromParsed(parsed, { title: "Paper Boats", artist: "Test", source: { kind: "paste", importedAt: "" } });
    const cho = songToChordPro(song);
    const back = parseChordPro(cho);
    const chords = (secs: typeof parsed.sections) => secs.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.chord)));
    expect(chords(back.sections)).toEqual(chords(parsed.sections.filter((s) => s.kind !== "notes")));
    expect(back.title).toBe("Paper Boats");
  });
});
