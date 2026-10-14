/**
 * Personal chord calibration: labelled takes of the player's own chords, turned
 * into personal templates, plus an honest before/after check that tests each
 * take against templates built only from the OTHER takes.
 */

import { normaliseChord, parseChord } from "../music/chords";
import { expectedTemplates, judgeFrame, rankChords, rotateChroma, templateFromPcs, type PersonalProfile } from "./chordTemplates";
import { chordsCompatible } from "../music/chords";

export interface CalibrationFrame {
  chroma: number[];
  bassPc: number;
}

export interface CalibrationTake {
  id: string;
  /** Chord as played (no capo), i.e. the sounding chord. */
  chord: string;
  frames: CalibrationFrame[];
  createdAt: string;
}

export interface CalibrationData {
  version: 1;
  takes: CalibrationTake[];
  updatedAt: string;
}

function normalise(v: Float64Array): Float64Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export function meanChroma(frames: CalibrationFrame[]): Float64Array {
  const acc = new Float64Array(12);
  for (const f of frames) {
    const n = normalise(Float64Array.from(f.chroma));
    for (let i = 0; i < 12; i++) acc[i] += n[i];
  }
  return normalise(acc);
}

/**
 * Share of the learned sound in each personal template; the rest is the
 * built-in template. 0.5 did best on GuitarSet (see README).
 */
const LEARNED_WEIGHT = 0.5;
const AMBIENT_WEIGHT = 0.6;

function blendWithBuiltIn(learned: Float64Array, chord: string): Float64Array {
  const c = parseChord(chord);
  if (!c) return learned;
  const builtIn = normalise(templateFromPcs(c.pcs, c.root));
  return normalise(learned.map((x, i) => LEARNED_WEIGHT * x + (1 - LEARNED_WEIGHT) * builtIn[i]));
}

export function buildProfile(takes: CalibrationTake[]): PersonalProfile | null {
  const byChord = new Map<string, CalibrationTake[]>();
  for (const t of takes) {
    if (!t.frames.length || !parseChord(t.chord)) continue;
    const k = normaliseChord(t.chord);
    byChord.set(k, [...(byChord.get(k) ?? []), t]);
  }
  if (byChord.size === 0) return null;
  const famAcc = new Map<string, Float64Array>();
  for (const [chord, ts] of byChord) {
    const tmpl = meanChroma(ts.flatMap((t) => t.frames));
    const c = parseChord(chord)!;
    if (c.bass !== null) continue; // slash chords don't generalise to a chord type
    const rooted = rotateChroma(tmpl, -c.root);
    const acc = famAcc.get(c.suffix) ?? new Float64Array(12);
    for (let i = 0; i < 12; i++) acc[i] += rooted[i];
    famAcc.set(c.suffix, acc);
  }
  const family = new Map<string, Float64Array>();
  for (const [q, acc] of famAcc) family.set(q, blendWithBuiltIn(normalise(acc), `C${q}`));
  const ambient = ambientOf(byChord);
  return family.size || ambient ? { family, ambient } : null;
}

/**
 * Energy that shows up at the same absolute pitch class in the takes of
 * different chords, beyond what the chords themselves explain. Only counted
 * when it appears in at least two different chords, so a single chord's
 * voicing isn't mistaken for the room.
 */
function ambientOf(byChord: Map<string, CalibrationTake[]>): Float64Array | null {
  if (byChord.size < 2) return null;
  const residuals: Array<{ pcs: number[]; r: Float64Array }> = [];
  for (const [chord, ts] of byChord) {
    const c = parseChord(chord)!;
    const heard = meanChroma(ts.flatMap((t) => t.frames));
    const expected = normalise(templateFromPcs(c.pcs, c.root));
    residuals.push({ pcs: c.pcs, r: heard.map((x, i) => Math.max(0, x - expected[i])) });
  }
  const ambient = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    // Only chords that don't contain this note can show it as extra; take the
    // lower median of those so a single chord's voicing can't dominate.
    const vals = residuals.filter((x) => !x.pcs.includes(i)).map((x) => x.r[i]).sort((a, b) => a - b);
    if (vals.length >= 2) ambient[i] = AMBIENT_WEIGHT * vals[Math.floor((vals.length - 1) / 2)];
  }
  return ambient.some((x) => x > 0.02) ? ambient : null;
}

/** A take that clearly sounds like another chord (likely a fumble or wrong label). */
export function checkTake(chord: string, frames: CalibrationFrame[]): { ok: true } | { ok: false; heard: string } {
  const sounding = normaliseChord(chord);
  const votes = new Map<string, number>();
  let mismatch = 0;
  for (const f of frames) {
    const j = judgeFrame(f.chroma, sounding, expectedTemplates(sounding), f.bassPc, null);
    if (j.verdict === "mismatch" && j.competitor) {
      mismatch++;
      votes.set(j.competitor.symbol, (votes.get(j.competitor.symbol) ?? 0) + 1);
    }
  }
  if (frames.length >= 6 && mismatch / frames.length >= 0.6) {
    const heard = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { ok: false, heard };
  }
  return { ok: true };
}

export interface ChordReport {
  chord: string;
  takes: number;
  frames: number;
  generic: { match: number; mismatch: number; unclear: number; top1: number };
  personal: { match: number; mismatch: number; unclear: number; top1: number } | null;
  /** What it was most often mistaken for (personal templates if available). */
  confusedWith: string | null;
}

function score(frames: CalibrationFrame[], chord: string, profile: PersonalProfile | null) {
  const s = { match: 0, mismatch: 0, unclear: 0, top1: 0 };
  const rivals = new Map<string, number>();
  for (const f of frames) {
    const j = judgeFrame(f.chroma, chord, expectedTemplates(chord), f.bassPc, profile);
    s[j.verdict === "match" ? "match" : j.verdict === "mismatch" ? "mismatch" : "unclear"]++;
    if (j.verdict === "mismatch" && j.competitor) rivals.set(j.competitor.symbol, (rivals.get(j.competitor.symbol) ?? 0) + 1);
    if (chordsCompatible(chord, rankChords(f.chroma, f.bassPc, profile)[0].symbol)) s.top1++;
  }
  const n = Math.max(1, frames.length);
  const pct = { match: s.match / n, mismatch: s.mismatch / n, unclear: s.unclear / n, top1: s.top1 / n };
  const confused = [...rivals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { pct, confused };
}

/**
 * Leave-one-take-out evaluation: each take is judged with a profile built from
 * all the other takes, so the "personal" numbers are not testing on training data.
 * Chords with a single take are judged against the other chords' learned chord types.
 */
export function evaluateCalibration(takes: CalibrationTake[]): ChordReport[] {
  const byChord = new Map<string, CalibrationTake[]>();
  for (const t of takes) byChord.set(normaliseChord(t.chord), [...(byChord.get(normaliseChord(t.chord)) ?? []), t]);
  const reports: ChordReport[] = [];
  for (const [chord, ts] of byChord) {
    const frames = ts.flatMap((t) => t.frames);
    const g = score(frames, chord, null);
    let personal: ChordReport["personal"] = null;
    let confused = g.confused;
    const totals = { match: 0, mismatch: 0, unclear: 0, top1: 0 };
    let n = 0;
    for (const held of ts) {
      const profile = buildProfile(takes.filter((t) => t.id !== held.id));
      if (!profile) continue;
      const r = score(held.frames, chord, profile);
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r.pct[k] * held.frames.length;
      n += held.frames.length;
      confused = r.confused ?? confused;
    }
    if (n > 0) personal = { match: totals.match / n, mismatch: totals.mismatch / n, unclear: totals.unclear / n, top1: totals.top1 / n };
    reports.push({ chord, takes: ts.length, frames: frames.length, generic: g.pct, personal, confusedWith: confused });
  }
  return reports.sort((a, b) => a.chord.localeCompare(b.chord));
}
