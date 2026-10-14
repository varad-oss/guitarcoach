/**
 * Offline analysis of a whole recording: tempo, beat grid, estimated chords,
 * downbeats and rough sections. Everything produced here is an ESTIMATE and is
 * labelled as such in the UI; people correct it in the alignment editor.
 */

import { magnitudeSpectrum } from "./fft";
import { chromaFromSpectrum, isTonal } from "./chroma";
import { correlation, expectedTemplates, templateFromPcs } from "./chordTemplates";
import { chordsCompatible, parseChord, pcToName } from "../music/chords";

export interface ChordSegment {
  startBeat: number;
  beats: number;
  start: number;
  end: number;
  chord: string | null;
  confidence: number;
}

export interface FileAnalysis {
  duration: number;
  bpm: number | null;
  bpmConfidence: number;
  beatTimes: number[];
  /** Index into beatTimes of the first estimated downbeat. */
  downbeatIndex: number;
  segments: ChordSegment[];
  /** Section boundaries in bars (from the first downbeat). */
  sections: Array<{ label: string; startBar: number; endBar: number }>;
  /** Per-beat chroma, kept for aligning a chord sheet. Not persisted. */
  beatChroma: Float64Array[];
  beatTonal: boolean[];
}

export interface AnalysisOptions {
  beatsPerBar: number;
  targetBpm?: number | null;
  a4?: number;
  onProgress?: (p: number) => void;
}

// ---------- onset envelope ----------

export function onsetEnvelope(x: Float32Array, sr: number, hop: number, n: number): Float64Array {
  const frames = Math.max(0, Math.floor((x.length - n) / hop) + 1);
  const env = new Float64Array(frames);
  let prev: Float64Array | null = null;
  const kMax = Math.min(n / 2, Math.ceil((8000 * n) / sr));
  for (let f = 0; f < frames; f++) {
    const mag = magnitudeSpectrum(x.subarray(f * hop, f * hop + n), n);
    const lg = new Float64Array(kMax + 2);
    for (let k = 0; k <= kMax + 1; k++) lg[k] = Math.log1p(100 * mag[k]);
    if (prev) {
      let s = 0;
      for (let k = 2; k <= kMax; k++) {
        const d = lg[k] - Math.max(prev[k - 1], prev[k], prev[k + 1]);
        if (d > 0) s += d;
      }
      env[f] = s;
    }
    prev = lg;
  }
  // Remove slow trend and normalise.
  const w = Math.max(1, Math.round((0.5 * sr) / hop));
  const out = new Float64Array(frames);
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    acc += env[i];
    if (i >= w) acc -= env[i - w];
    const mean = acc / Math.min(i + 1, w);
    out[i] = Math.max(0, env[i] - mean);
  }
  let sd = 0;
  for (const v of out) sd += v * v;
  sd = Math.sqrt(sd / Math.max(1, frames)) || 1;
  for (let i = 0; i < frames; i++) out[i] /= sd;
  return out;
}

// ---------- tempo ----------

export function estimateTempoFromEnvelope(env: Float64Array, frameRate: number, targetBpm?: number | null): { bpm: number; confidence: number } | null {
  const minLag = Math.floor((60 / 220) * frameRate);
  const maxLag = Math.ceil((60 / 40) * frameRate);
  if (env.length < maxLag * 3) return null;
  const acf = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    acf[lag] = s / (env.length - lag);
  }
  const center = targetBpm && targetBpm > 30 ? targetBpm : 110;
  let best = -1;
  let bestVal = -Infinity;
  let sum = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / center) / (targetBpm ? 0.35 : 1.0)) ** 2);
    const v = acf[lag] * prior;
    sum += acf[lag];
    count++;
    if (v > bestVal) {
      bestVal = v;
      best = lag;
    }
  }
  if (best < 0) return null;
  const a = acf[best - 1];
  const b = acf[best];
  const c = acf[best + 1];
  const denom = a - 2 * b + c;
  const refined = denom !== 0 ? best + (0.5 * (a - c)) / denom : best;
  const mean = sum / count;
  const confidence = Math.max(0, Math.min(1, (b / Math.max(mean, 1e-9) - 1) / 2));
  return { bpm: (60 * frameRate) / refined, confidence };
}

// ---------- beat tracking (dynamic programming, after Ellis 2007) ----------

export function trackBeats(env: Float64Array, frameRate: number, bpm: number, tightness = 100): number[] {
  const period = (60 / bpm) * frameRate;
  const n = env.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period * 0.5);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestPrev = -1;
    let bestVal = 0;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const penalty = tightness * Math.log((t - tau) / period) ** 2;
      const v = score[tau] - penalty;
      if (bestPrev < 0 || v > bestVal) {
        bestVal = v;
        bestPrev = tau;
      }
    }
    score[t] = env[t] + (bestPrev >= 0 ? Math.max(0, bestVal) : 0);
    back[t] = bestPrev >= 0 && bestVal > 0 ? bestPrev : -1;
  }
  let end = Math.max(0, n - Math.round(period));
  for (let t = end; t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  beats.reverse();
  // Extend the grid back to the start of the audio if the DP stopped early.
  const first = beats[0] ?? 0;
  const extra: number[] = [];
  for (let t = first - period; t >= 0; t -= period) extra.unshift(Math.round(t));
  return [...extra, ...beats];
}

// ---------- chords ----------

const STATES = (() => {
  const out: Array<{ symbol: string; template: Float64Array }> = [];
  for (let r = 0; r < 12; r++) {
    for (const q of ["", "m", "7", "m7"]) {
      const symbol = pcToName(r, [1, 3, 8, 10].includes(r)) + q;
      out.push({ symbol, template: templateFromPcs(parseChord(symbol)!.pcs, r) });
    }
  }
  return out;
})();

function viterbiChords(beatChroma: Float64Array[], tonal: boolean[]): { labels: Array<string | null>; margins: number[] } {
  const S = STATES.length + 1; // last = no chord
  const T = beatChroma.length;
  if (T === 0) return { labels: [], margins: [] };
  const kappa = 14;
  const stay = Math.log(0.88);
  const move = Math.log(0.12 / (S - 1));
  const emis = (t: number, s: number) => {
    if (s === S - 1) return tonal[t] ? kappa * 0.25 : kappa * 1.2;
    return tonal[t] ? kappa * correlation(beatChroma[t], STATES[s].template) : 0;
  };
  let prev = new Float64Array(S);
  for (let s = 0; s < S; s++) prev[s] = emis(0, s);
  const ptr: Int32Array[] = [];
  for (let t = 1; t < T; t++) {
    const cur = new Float64Array(S);
    const p = new Int32Array(S);
    let bestAll = 0;
    for (let s = 1; s < S; s++) if (prev[s] > prev[bestAll]) bestAll = s;
    for (let s = 0; s < S; s++) {
      const fromSelf = prev[s] + stay;
      const fromBest = prev[bestAll] + move;
      if (fromSelf >= fromBest) {
        cur[s] = fromSelf + emis(t, s);
        p[s] = s;
      } else {
        cur[s] = fromBest + emis(t, s);
        p[s] = bestAll;
      }
    }
    ptr.push(p);
    prev = cur;
  }
  let s = 0;
  for (let i = 1; i < S; i++) if (prev[i] > prev[s]) s = i;
  const path = new Array<number>(T);
  path[T - 1] = s;
  for (let t = T - 1; t > 0; t--) {
    s = ptr[t - 1][s];
    path[t - 1] = s;
  }
  const labels = path.map((st) => (st === S - 1 ? null : STATES[st].symbol));
  const margins = labels.map((lab, t) => {
    if (!lab || !tonal[t]) return 0;
    const own = correlation(beatChroma[t], STATES.find((x) => x.symbol === lab)!.template);
    let other = -1;
    for (const st of STATES) if (!chordsCompatible(lab, st.symbol)) other = Math.max(other, correlation(beatChroma[t], st.template));
    return Math.max(0, Math.min(1, (own - other) / 0.25));
  });
  return { labels, margins };
}

// ---------- full pipeline ----------

export function analyseRecording(samples: Float32Array, sr: number, opts: AnalysisOptions): FileAnalysis {
  const duration = samples.length / sr;
  const hop = sr > 32000 ? 512 : 256;
  const n = hop * 4;
  const frameRate = sr / hop;
  opts.onProgress?.(0.05);
  const env = onsetEnvelope(samples, sr, hop, n);
  opts.onProgress?.(0.35);
  const tempo = estimateTempoFromEnvelope(env, frameRate, opts.targetBpm);
  if (!tempo) {
    return { duration, bpm: null, bpmConfidence: 0, beatTimes: [], downbeatIndex: 0, segments: [], sections: [], beatChroma: [], beatTonal: [] };
  }
  const beatFrames = trackBeats(env, frameRate, tempo.bpm);
  const beatTimes = beatFrames.map((f) => (f * hop + n * 0.25) / sr).filter((t) => t < duration);
  opts.onProgress?.(0.5);

  // Chroma frames.
  const cn = sr > 32000 ? 8192 : 4096;
  const chop = cn / 4;
  const chromaFrames: Array<{ t: number; chroma: Float64Array; tonal: boolean }> = [];
  for (let start = 0; start + cn <= samples.length; start += chop) {
    const mag = magnitudeSpectrum(samples.subarray(start, start + cn), cn);
    const c = chromaFromSpectrum(mag, { sampleRate: sr, fftSize: cn, a4: opts.a4 });
    chromaFrames.push({ t: (start + cn / 2) / sr, chroma: c.chroma, tonal: isTonal(c) });
  }
  opts.onProgress?.(0.8);

  const beatChroma: Float64Array[] = [];
  const beatTonal: boolean[] = [];
  let fi = 0;
  for (let b = 0; b < beatTimes.length; b++) {
    const t0 = beatTimes[b];
    const t1 = beatTimes[b + 1] ?? t0 + 60 / tempo.bpm;
    const acc = new Float64Array(12);
    let tonalCount = 0;
    let count = 0;
    while (fi < chromaFrames.length && chromaFrames[fi].t < t0) fi++;
    for (let j = fi; j < chromaFrames.length && chromaFrames[j].t < t1; j++) {
      count++;
      if (chromaFrames[j].tonal) {
        tonalCount++;
        for (let i = 0; i < 12; i++) acc[i] += chromaFrames[j].chroma[i];
      }
    }
    beatChroma.push(acc);
    beatTonal.push(count > 0 && tonalCount / count >= 0.5);
  }

  const { labels, margins } = viterbiChords(beatChroma, beatTonal);

  // Downbeat phase: chord changes tend to land on the first beat of a bar.
  const B = Math.max(1, opts.beatsPerBar);
  const phaseScore = new Array(B).fill(0);
  for (let i = 1; i < labels.length; i++) if (labels[i] !== labels[i - 1]) phaseScore[i % B] += 1;
  let phase = 0;
  for (let p = 1; p < B; p++) if (phaseScore[p] > phaseScore[phase]) phase = p;

  const segments: ChordSegment[] = [];
  for (let i = phase; i < labels.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.chord === labels[i]) {
      last.beats++;
      last.end = beatTimes[i + 1] ?? last.end;
      last.confidence += margins[i];
    } else {
      segments.push({ startBeat: i - phase, beats: 1, start: beatTimes[i], end: beatTimes[i + 1] ?? beatTimes[i] + 60 / tempo.bpm, chord: labels[i], confidence: margins[i] });
    }
  }
  for (const s of segments) s.confidence = Math.round((s.confidence / s.beats) * 100) / 100;

  const sections = findSections(beatChroma.slice(phase), beatTonal.slice(phase), B);
  opts.onProgress?.(1);
  return { duration, bpm: Math.round(tempo.bpm * 10) / 10, bpmConfidence: tempo.confidence, beatTimes, downbeatIndex: phase, segments, sections, beatChroma, beatTonal };
}

function findSections(beatChroma: Float64Array[], tonal: boolean[], B: number): Array<{ label: string; startBar: number; endBar: number }> {
  const nBars = Math.floor(beatChroma.length / B);
  if (nBars < 8) return nBars > 0 ? [{ label: "A", startBar: 0, endBar: nBars }] : [];
  const bars: Float64Array[] = [];
  for (let b = 0; b < nBars; b++) {
    const acc = new Float64Array(12);
    for (let k = 0; k < B; k++) if (tonal[b * B + k]) for (let i = 0; i < 12; i++) acc[i] += beatChroma[b * B + k][i];
    bars.push(acc);
  }
  const K = 4;
  const novelty = new Float64Array(nBars);
  for (let c = K; c < nBars - K; c++) {
    let s = 0;
    for (let i = -K; i < K; i++)
      for (let j = -K; j < K; j++) {
        const sign = (i < 0) === (j < 0) ? 1 : -1;
        s += sign * correlation(bars[c + i], bars[c + j]);
      }
    novelty[c] = Math.max(0, s);
  }
  const mean = novelty.reduce((a, b) => a + b, 0) / nBars;
  const sd = Math.sqrt(novelty.reduce((a, b) => a + (b - mean) ** 2, 0) / nBars);
  const bounds = [0];
  for (let c = K; c < nBars - K; c++) {
    const isPeak = novelty[c] >= novelty[c - 1] && novelty[c] >= novelty[c + 1] && novelty[c] > mean + 0.5 * sd;
    if (isPeak && c - bounds[bounds.length - 1] >= 4) bounds.push(c);
  }
  bounds.push(nBars);
  const segs = bounds.slice(0, -1).map((s, i) => ({ startBar: s, endBar: bounds[i + 1] }));
  const labels: string[] = [];
  const mean12 = (s: { startBar: number; endBar: number }) => {
    const acc = new Float64Array(12);
    for (let b = s.startBar; b < s.endBar; b++) for (let i = 0; i < 12; i++) acc[i] += bars[b][i];
    return acc;
  };
  const means = segs.map(mean12);
  let next = 0;
  segs.forEach((_, i) => {
    for (let j = 0; j < i; j++) {
      if (correlation(means[i], means[j]) > 0.9) {
        labels[i] = labels[j];
        return;
      }
    }
    labels[i] = String.fromCharCode(65 + Math.min(25, next++));
  });
  return segs.map((s, i) => ({ ...s, label: labels[i] }));
}

/**
 * Finds where a chord sheet's timeline starts in a recording by testing each
 * candidate start beat and scoring how well the expected chords fit the audio.
 */
export function alignSheetToBeats(
  events: Array<{ chord: string; startBeat: number; beats: number; voicing?: number[] }>,
  beatChroma: Float64Array[],
  beatTonal: boolean[],
  maxStart = 96,
): { startBeat: number; score: number; margin: number } | null {
  if (events.length === 0 || beatChroma.length === 0) return null;
  const templates = events.map((e) => expectedTemplates(e.chord, e.voicing));
  const scores: number[] = [];
  const limit = Math.min(maxStart, Math.max(0, beatChroma.length - 4));
  for (let s = 0; s <= limit; s++) {
    let total = 0;
    let n = 0;
    events.forEach((e, k) => {
      for (let b = 0; b < Math.round(e.beats); b++) {
        const idx = s + Math.round(e.startBeat) + b;
        if (idx >= beatChroma.length) return;
        if (!beatTonal[idx]) continue;
        total += Math.max(...templates[k].map((t) => correlation(beatChroma[idx], t)));
        n++;
      }
    });
    scores.push(n >= 8 ? total / n : -1);
  }
  let best = 0;
  for (let s = 1; s < scores.length; s++) if (scores[s] > scores[best]) best = s;
  if (scores[best] < 0) return null;
  let second = -1;
  scores.forEach((v, s) => {
    if (Math.abs(s - best) > 1 && v > second) second = v;
  });
  return { startBeat: best, score: scores[best], margin: scores[best] - Math.max(second, 0) };
}
