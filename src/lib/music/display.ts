/**
 * Display transformations — transpose, capo and simplify — applied on top of
 * the stored song. The stored chords never change; practice, diagrams and
 * chord detection all use the transformed song so they agree with what you
 * see and play.
 */

import { keyPrefersFlats, parseChord, pcToName, transposeChord } from "./chords";
import { chordDifficulty } from "./shapes";
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

export interface EasiestShapes {
  capo: number;
  transpose: number;
  /** The distinct chords you'd play, most frequent first. */
  chords: string[];
  /** Share of chord changes that use open-position shapes. */
  openShare: number;
}

/**
 * The capo position (0–7) whose shapes are easiest to play while the song
 * sounds exactly as written: chords are simplified, then each position is
 * scored by how hard its shapes are, weighted by how often each chord comes
 * up, with a small preference for a lower capo.
 */
export function easiestShapes(song: Pick<Song, "key" | "capo" | "sections">, maxCapo = 7): EasiestShapes | null {
  const counts = new Map<string, number>();
  for (const s of song.sections) for (const l of s.lines) for (const c of l.chords) {
    const simple = simplifyChord(c.chord);
    if (parseChord(simple)) counts.set(simple, (counts.get(simple) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  let best: (EasiestShapes & { score: number }) | null = null;
  for (let capo = 0; capo <= maxCapo; capo++) {
    const prefs: DisplayPrefs = { ...DEFAULT_DISPLAY, simplify: true, capo, transpose: song.capo - capo };
    const map = chordMapper(song, prefs);
    let difficulty = 0;
    let open = 0;
    const shown = new Map<string, number>();
    for (const [chord, n] of counts) {
      const played = map(chord);
      const d = chordDifficulty(played);
      difficulty += d * n;
      if (d === 1) open += n;
      shown.set(played, (shown.get(played) ?? 0) + n);
    }
    const score = difficulty / total + 0.04 * capo + (capo > 5 ? 0.15 : 0);
    if (!best || score < best.score - 1e-9) {
      best = { capo, transpose: prefs.transpose, score, openShare: open / total, chords: [...shown.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c) };
    }
  }
  const { score: _score, ...result } = best!;
  void _score;
  return result;
}
