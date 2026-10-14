/**
 * Chord recognition by matching chroma against harmonic chord templates.
 *
 * A guitar note contributes energy at its harmonics (octave, 12th, 2nd octave,
 * major 17th …), so each template sums decaying harmonic series for every chord
 * tone. Templates can also be built from the exact notes of a known voicing.
 */

import { chordsCompatible, chordsOverlap, parseChord, pcToName } from "../music/chords";

const HARMONIC_OFFSETS = [0, 12, 19, 24, 28, 31];
const DECAY = 0.6;

function harmonicSeries(midiOrPc: number, out: Float64Array, weight = 1): void {
  HARMONIC_OFFSETS.forEach((off, h) => {
    out[(((midiOrPc + off) % 12) + 12) % 12] += weight * Math.pow(DECAY, h);
  });
}

export function templateFromPcs(pcs: number[], root?: number): Float64Array {
  const t = new Float64Array(12);
  for (const pc of pcs) harmonicSeries(pc, t, pc === root ? 1.15 : 1);
  return t;
}

/** Template from the actual sounding notes of a voicing (MIDI numbers). */
export function templateFromMidi(notes: number[]): Float64Array {
  const t = new Float64Array(12);
  // Lower strings are usually louder on a strummed guitar.
  const sorted = [...notes].sort((a, b) => a - b);
  sorted.forEach((n, i) => harmonicSeries(n, t, 1 - i * 0.05));
  return t;
}

export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

interface VocabEntry {
  symbol: string;
  root: number;
  template: Float64Array;
  penalty: number;
}

const QUALITIES: Array<[string, number]> = [
  ["", 0],
  ["m", 0],
  ["7", 0.03],
  ["m7", 0.03],
  ["maj7", 0.035],
  ["sus2", 0.035],
  ["sus4", 0.035],
  ["add9", 0.035],
  ["5", 0.05],
  ["dim", 0.05],
];

let vocab: VocabEntry[] | null = null;
export function vocabulary(): VocabEntry[] {
  if (vocab) return vocab;
  vocab = [];
  for (let r = 0; r < 12; r++) {
    for (const [q, penalty] of QUALITIES) {
      const symbol = pcToName(r, [1, 3, 8, 10].includes(r)) + q;
      const c = parseChord(symbol)!;
      vocab.push({ symbol, root: r, template: templateFromPcs(c.pcs, r), penalty });
    }
  }
  return vocab;
}

export interface Candidate {
  symbol: string;
  score: number;
}

/**
 * Personal templates learned from the player's own calibration takes: the
 * learned sound of each chord type, blended with the built-in template and
 * moved to every root, so it applies to all candidate chords alike. Per-chord
 * templates were tried and dropped: on GuitarSet they made a rival chord look
 * likelier whenever that rival had been recorded, which raised false
 * "wrong chord" verdicts.
 */
export interface PersonalProfile {
  /** Chord quality ("", "m", "7" …) → template with its root moved to C. */
  family: Map<string, Float64Array>;
  /**
   * Pitch classes the player's setup adds to every chord (a ringing body or
   * room note, sympathetic strings), at their absolute pitch. Added to every
   * template, built-in and personal, so it doesn't favour any chord.
   */
  ambient: Float64Array | null;
}

function withAmbient(t: ArrayLike<number>, profile: PersonalProfile | null): ArrayLike<number> {
  if (!profile?.ambient) return t;
  let n = 0;
  for (let i = 0; i < 12; i++) n += t[i] * t[i];
  n = Math.sqrt(n) || 1;
  const out = new Float64Array(12);
  for (let i = 0; i < 12; i++) out[i] = t[i] / n + profile.ambient[i];
  return out;
}

let activeProfile: PersonalProfile | null = null;
export function setPersonalProfile(p: PersonalProfile | null): void {
  activeProfile = p;
}
export function getPersonalProfile(): PersonalProfile | null {
  return activeProfile;
}

export function rotateChroma(c: ArrayLike<number>, semitones: number): Float64Array {
  const out = new Float64Array(12);
  for (let i = 0; i < 12; i++) out[(((i + semitones) % 12) + 12) % 12] = c[i];
  return out;
}

export function personalTemplate(symbol: string, profile: PersonalProfile | null = activeProfile): Float64Array | null {
  if (!profile) return null;
  const c = parseChord(symbol);
  if (!c) return null;
  const fam = profile.family.get(c.suffix);
  return fam ? rotateChroma(fam, c.root) : null;
}

/** All vocabulary chords ranked by match score. */
export function rankChords(chroma: ArrayLike<number>, bassPc = -1, profile: PersonalProfile | null = activeProfile): Candidate[] {
  return vocabulary()
    .map((v) => {
      let s = correlation(chroma, withAmbient(v.template, profile));
      const p = profile ? personalTemplate(v.symbol, profile) : null;
      if (p) s = Math.max(s, correlation(chroma, withAmbient(p, profile)));
      return { symbol: v.symbol, score: s - v.penalty + (bassPc === v.root ? 0.03 : 0) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Template for an expected chord, preferring the exact voicing when known. */
export function expectedTemplates(symbol: string, voicingMidi?: number[]): Float64Array[] {
  const c = parseChord(symbol);
  const out: Float64Array[] = [];
  if (c) out.push(templateFromPcs(c.pcs, c.root));
  if (voicingMidi && voicingMidi.length >= 2) out.push(templateFromMidi(voicingMidi));
  return out;
}

export type FrameVerdict = "match" | "mismatch" | "unclear";

export interface FrameJudgement {
  verdict: FrameVerdict;
  expectedScore: number;
  /** Best-matching chord that is NOT an acceptable rendition of the expected chord (nor shares nearly all its notes). */
  competitor: Candidate | null;
  best: Candidate;
}

/**
 * Compares the audio against the expected chord and its strongest alternative.
 * It only calls something a mismatch when another chord fits clearly better.
 */
export function judgeFrame(chroma: ArrayLike<number>, expected: string, templates: Float64Array[], bassPc = -1, profile: PersonalProfile | null = activeProfile): FrameJudgement {
  const ranked = rankChords(chroma, bassPc, profile);
  const own = profile ? personalTemplate(expected, profile) : null;
  if (own) templates = [...templates, own];
  const best = ranked[0];
  const exp = parseChord(expected);
  const expBass = exp ? (bassPc === exp.root || bassPc === exp.bass ? 0.03 : 0) : 0;
  const expectedScore = Math.max(...templates.map((t) => correlation(chroma, withAmbient(t, profile)))) + expBass;
  const competitor = ranked.find((c) => !chordsCompatible(expected, c.symbol) && !chordsOverlap(expected, c.symbol)) ?? null;
  let verdict: FrameVerdict = "unclear";
  if (expectedScore >= 0.55 && (!competitor || expectedScore >= competitor.score - 0.03)) verdict = "match";
  else if (competitor && competitor.score >= 0.6 && competitor.score - expectedScore >= 0.1) verdict = "mismatch";
  return { verdict, expectedScore, competitor, best };
}
