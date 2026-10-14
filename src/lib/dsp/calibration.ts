/**
 * Personal chord calibration: labelled takes of the player's own chords, turned
 * into personal templates, plus an honest before/after check that tests each
 * take against templates built only from the OTHER takes.
 */

import { normaliseChord, parseChord } from "../music/chords";
import { expectedTemplates, judgeFrame, rankChords, rotateChroma, type PersonalProfile } from "./chordTemplates";
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

export function buildProfile(takes: CalibrationTake[]): PersonalProfile | null {
  const byChord = new Map<string, CalibrationTake[]>();
  for (const t of takes) {
    if (!t.frames.length || !parseChord(t.chord)) continue;
    const k = normaliseChord(t.chord);
    byChord.set(k, [...(byChord.get(k) ?? []), t]);
  }
  if (byChord.size === 0) return null;
  const exact = new Map<string, Float64Array>();
  const famAcc = new Map<string, Float64Array>();
  for (const [chord, ts] of byChord) {
    const tmpl = meanChroma(ts.flatMap((t) => t.frames));
    exact.set(chord, tmpl);
    const c = parseChord(chord)!;
    if (c.bass !== null) continue; // slash chords don't generalise to a chord type
    const rooted = rotateChroma(tmpl, -c.root);
    const acc = famAcc.get(c.suffix) ?? new Float64Array(12);
    for (let i = 0; i < 12; i++) acc[i] += rooted[i];
    famAcc.set(c.suffix, acc);
  }
  const family = new Map<string, Float64Array>();
  for (const [q, acc] of famAcc) family.set(q, normalise(acc));
  return { exact, family };
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
