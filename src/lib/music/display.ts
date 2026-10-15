/**
 * Display transformations — transpose, capo and simplify — applied on top of
 * the stored song. The stored chords never change; practice, diagrams and
 * chord detection all use the transformed song so they agree with what you
 * see and play.
 */

import { keyPrefersFlats, parseChord, pcToName, transposeChord } from "./chords";
import { DEFAULT_DISPLAY, type DisplayPrefs, type Song } from "../song/model";

/** Reduces a chord to its basic triad: Cadd9 → C, Em7 → Em, D/F# → D, Dsus4 → D. */
export function simplifyChord(symbol: string): string {
  const c = parseChord(symbol);
  if (!c) return symbol;
  const root = c.rootName;
  switch (c.family) {
    case "min":
      return `${root}m`;
    case "dim":
      return `${root}dim`;
    case "aug":
      return `${root}aug`;
    default:
      return root;
  }
}

export function prefsOf(song: Pick<Song, "display">): DisplayPrefs {
  return { ...DEFAULT_DISPLAY, ...(song.display ?? {}) };
}

export function effectiveCapo(song: Pick<Song, "capo">, prefs: DisplayPrefs): number {
  return prefs.capo ?? song.capo;
}

function keyName(root: number, minor: boolean, flatsHint?: boolean): string {
  const probe = pcToName(root, false) + (minor ? "m" : "");
  const flats = flatsHint ?? keyPrefersFlats(probe);
  return pcToName(root, flats) + (minor ? "m" : "");
}

/**
 * song.key is the key the song SOUNDS in when played as written (that is what
 * sites like Ultimate Guitar list, e.g. "Key Ab, capo 1" with G shapes).
 * This is the key of the shapes you see with the current transpose.
 */
export function shownKey(song: Pick<Song, "key" | "capo">, prefs: DisplayPrefs): string | undefined {
  const k = song.key ? parseChord(song.key) : null;
  if (!k) return undefined;
  return keyName(k.root - song.capo + prefs.transpose, k.family === "min");
}

/** Semitones between the sound with these settings and the sound as written. */
export function pitchOffset(song: Pick<Song, "capo">, prefs: DisplayPrefs): number {
  const d = (((prefs.transpose + effectiveCapo(song, prefs) - song.capo) % 12) + 12) % 12;
  return d > 6 ? d - 12 : d;
}

/** Key the music actually sounds in with the chosen transpose and capo. */
export function soundingKey(song: Pick<Song, "key" | "capo">, prefs: DisplayPrefs): string | undefined {
  const k = song.key ? parseChord(song.key) : null;
  if (!k) return undefined;
  return keyName(k.root + pitchOffset(song, prefs), k.family === "min");
}

/** Chord-name mapper for display. */
export function chordMapper(song: Pick<Song, "key" | "capo">, prefs: DisplayPrefs): (c: string) => string {
  const t = prefs.transpose;
  const sk = shownKey(song, prefs);
  const flats = sk ? keyPrefersFlats(sk) : undefined;
  return (c: string) => {
    let out = prefs.simplify ? simplifyChord(c) : c;
    if (t) out = transposeChord(out, t, flats);
    return out;
  };
}

export function isIdentity(prefs: DisplayPrefs): boolean {
  return prefs.transpose === 0 && !prefs.simplify;
}

/**
 * The song as it should be played with these settings: chord names mapped,
 * capo replaced, and chord shapes kept only where they still apply.
 */
export function applyDisplay(song: Song, prefs: DisplayPrefs = prefsOf(song)): Song {
  const capo = effectiveCapo(song, prefs);
  if (isIdentity(prefs)) return capo === song.capo ? song : { ...song, capo, key: soundingKey(song, prefs) ?? song.key };
  const map = chordMapper(song, prefs);
  return {
    ...song,
    capo,
    // Keep the stored convention: key = how it sounds with this song's (new) capo.
    key: soundingKey(song, prefs) ?? song.key,
    sections: song.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l, chords: l.chords.map((c) => ({ ...c, chord: map(c.chord) })) })),
    })),
    // Written voicings only still apply to chords whose name didn't change; others come from the chord library.
    chordShapes: prefs.transpose === 0 ? Object.fromEntries(Object.entries(song.chordShapes).filter(([name]) => map(name) === name)) : {},
  };
}
