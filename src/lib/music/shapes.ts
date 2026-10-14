/**
 * Guitar chord shapes. Frets are listed from the low E string to the high E
 * string; null marks a muted string and 0 an open string.
 */

import { parseChord, transposeChord } from "./chords";

export type Frets = (number | null)[];

/** Standard tuning, low to high, as MIDI note numbers. */
export const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64];
export const STANDARD_TUNING_NAMES = ["E", "A", "D", "G", "B", "E"];

const OPEN_SHAPES: Record<string, Frets> = {
  C: [null, 3, 2, 0, 1, 0],
  Cmaj7: [null, 3, 2, 0, 0, 0],
  C7: [null, 3, 2, 3, 1, 0],
  Cadd9: [null, 3, 2, 0, 3, 0],
  D: [null, null, 0, 2, 3, 2],
  Dm: [null, null, 0, 2, 3, 1],
  D7: [null, null, 0, 2, 1, 2],
  Dmaj7: [null, null, 0, 2, 2, 2],
  Dm7: [null, null, 0, 2, 1, 1],
  Dsus2: [null, null, 0, 2, 3, 0],
  Dsus4: [null, null, 0, 2, 3, 3],
  "D/F#": [2, null, 0, 2, 3, 2],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  E7: [0, 2, 0, 1, 0, 0],
  Em7: [0, 2, 2, 0, 3, 0],
  Esus4: [0, 2, 2, 2, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Fmaj7: [null, null, 3, 2, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  G7: [3, 2, 0, 0, 0, 1],
  "G/B": [null, 2, 0, 0, 3, 3],
  A: [null, 0, 2, 2, 2, 0],
  Am: [null, 0, 2, 2, 1, 0],
  A7: [null, 0, 2, 0, 2, 0],
  Am7: [null, 0, 2, 0, 1, 0],
  Asus2: [null, 0, 2, 2, 0, 0],
  Asus4: [null, 0, 2, 2, 3, 0],
  Amaj7: [null, 0, 2, 1, 2, 0],
  B7: [null, 2, 1, 2, 0, 2],
  Bm: [null, 2, 4, 4, 3, 2],
  E5: [0, 2, 2, null, null, null],
  A5: [null, 0, 2, 2, null, null],
  G5: [3, 5, 5, null, null, null],
};

/** Movable barre shapes relative to their root fret. */
const E_SHAPES: Record<string, number[]> = {
  "": [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  "7": [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  "5": [0, 2, 2, -1, -1, -1],
};
const A_SHAPES: Record<string, number[]> = {
  "": [-1, 0, 2, 2, 2, 0],
  m: [-1, 0, 2, 2, 1, 0],
  "7": [-1, 0, 2, 0, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
  sus2: [-1, 0, 2, 2, 0, 0],
  sus4: [-1, 0, 2, 2, 3, 0],
  "5": [-1, 0, 2, 2, -1, -1],
};

/**
 * A playable shape for a chord: an open shape if one exists, otherwise an E- or
 * A-string barre shape. Returns null for chords with no shape in the library.
 */
export function shapeForChord(symbol: string): Frets | null {
  const c = parseChord(symbol);
  if (!c) return null;
  const key = c.symbol;
  if (OPEN_SHAPES[key]) return OPEN_SHAPES[key];
  const sharpSpelled = transposeChord(key, 0, false);
  if (OPEN_SHAPES[sharpSpelled]) return OPEN_SHAPES[sharpSpelled];
  const base = c.rootName + c.suffix;
  if (c.bass === null && OPEN_SHAPES[base]) return OPEN_SHAPES[base];

  const eFret = (c.root - 4 + 12) % 12 || 12;
  const aFret = (c.root - 9 + 12) % 12 || 12;
  const pick = (shapes: Record<string, number[]>, fret: number) => {
    const s = shapes[c.suffix];
    if (!s) return null;
    const f = fret === 12 ? 0 : fret;
    return s.map((x) => (x < 0 ? null : x + f));
  };
  const useA = aFret < eFret;
  return (useA ? pick(A_SHAPES, aFret) ?? pick(E_SHAPES, eFret) : pick(E_SHAPES, eFret) ?? pick(A_SHAPES, aFret)) ?? null;
}

/** Sounding MIDI notes for a shape, accounting for a capo. */
export function shapeToMidi(frets: Frets, capo = 0, tuning = STANDARD_TUNING_MIDI): number[] {
  const notes: number[] = [];
  frets.forEach((f, i) => {
    if (f !== null && f !== undefined) notes.push(tuning[i] + capo + f);
  });
  return notes;
}

/**
 * Parses a fret string in the formats found on chord sheets:
 * "x32010", "x-3-2-0-1-0", "3 2 0 0 0 3", "3-x-0-0-3(3)", "x x 10 9 8 x".
 */
export function parseFretString(input: string): Frets | null {
  // "3-x-0-0-3(3)": a parenthesised fret is an optional note on that string.
  const s = input.trim().replace(/\((\d{1,2}|x)\)/gi, "-$1").replace(/^-+|-+$/g, "");
  let parts: string[];
  if (/[-\s]/.test(s)) parts = s.split(/[-\s]+/).filter(Boolean);
  else parts = s.split("");
  if (parts.length !== 6) return null;
  const frets: Frets = [];
  for (const p of parts) {
    if (/^[xX]$/.test(p)) frets.push(null);
    else if (/^\d{1,2}$/.test(p) && Number(p) <= 24) frets.push(Number(p));
    else return null;
  }
  return frets;
}

export function formatFrets(frets: Frets): string {
  const wide = frets.some((f) => f !== null && f >= 10);
  return frets.map((f) => (f === null ? "x" : String(f))).join(wide ? "-" : "");
}
