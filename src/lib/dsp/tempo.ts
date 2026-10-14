/**
 * Tempo from onset times. Refuses to answer without enough consistent
 * evidence: a BPM is only reported from several onsets that fit a steady grid.
 */

export interface TempoEstimate {
  bpm: number;
  /** Fraction of onsets that sit on the fitted grid (0..1). */
  confidence: number;
  /** Onsets used. */
  n: number;
  /** Coefficient of variation of the measured beat intervals, %. */
  driftPct: number;
}

export const MIN_ONSETS_FOR_TEMPO = 8;

function combScore(times: number[], period: number): number {
  let s = 0;
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      const d = times[j] - times[i];
      if (d > 4) break;
      const r = d / period;
      const k = Math.round(r);
      if (k < 1) continue;
      const e = (r - k) / 0.06;
      s += Math.exp(-0.5 * e * e) / Math.sqrt(k);
    }
  }
  return s;
}

/**
 * Estimates tempo. `targetBpm` (if known) resolves half/double-tempo ambiguity;
 * `subdivision` says how many onsets per beat the player is expected to make
 * (e.g. 2 for eighth-note strumming), so their tempo is reported in beats.
 */
export function estimateTempo(onsetTimes: number[], opts: { targetBpm?: number; minOnsets?: number } = {}): TempoEstimate | null {
  const minOnsets = opts.minOnsets ?? MIN_ONSETS_FOR_TEMPO;
  const times = [...onsetTimes].sort((a, b) => a - b);
  if (times.length < minOnsets) return null;
  if (times[times.length - 1] - times[0] < 2) return null;

  let bestBpm = 0;
  let bestScore = 0;
  for (let bpm = 40; bpm <= 240; bpm += 0.5) {
    const sc = combScore(times, 60 / bpm);
    if (sc > bestScore) {
      bestScore = sc;
      bestBpm = bpm;
    }
  }
  if (bestScore <= 0) return null;

  // Resolve octave errors: prefer the multiple nearest the target, else 60–160 BPM.
  const candidates = [bestBpm / 2, bestBpm, bestBpm * 2, (bestBpm * 2) / 3, (bestBpm * 3) / 2].filter((b) => b >= 35 && b <= 260);
  let chosen = bestBpm;
  if (opts.targetBpm) {
    chosen = candidates.reduce((a, b) => (Math.abs(Math.log2(b / opts.targetBpm!)) < Math.abs(Math.log2(a / opts.targetBpm!)) ? b : a));
    // Only switch away from the strongest period if the alternative is also supported.
    if (chosen !== bestBpm && combScore(times, 60 / chosen) < bestScore * 0.35) chosen = bestBpm;
  } else {
    while (chosen > 160) chosen /= 2;
    while (chosen < 60) chosen *= 2;
  }

  // Refine by least squares on onsets that fit the grid.
  const period0 = 60 / chosen;
  const idx: number[] = [];
  const fit: number[] = [];
  for (const t of times) {
    const k = (t - times[0]) / period0;
    if (Math.abs(k - Math.round(k)) < 0.2) {
      idx.push(Math.round(k));
      fit.push(t);
    }
  }
  if (fit.length < Math.max(4, Math.floor(minOnsets * 0.6))) return null;
  const n = fit.length;
  const mx = idx.reduce((a, b) => a + b, 0) / n;
  const my = fit.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (idx[i] - mx) ** 2;
    sxy += (idx[i] - mx) * (fit[i] - my);
  }
  if (sxx === 0) return null;
  const period = sxy / sxx;

  // Drift: variation of per-beat intervals between consecutive grid onsets.
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) {
    const steps = idx[i] - idx[i - 1];
    if (steps >= 1 && steps <= 4) intervals.push((fit[i] - fit[i - 1]) / steps);
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
  const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, intervals.length));
  return {
    bpm: Math.round((60 / period) * 10) / 10,
    confidence: n / times.length,
    n,
    driftPct: mean > 0 ? (sd / mean) * 100 : 0,
  };
}

/** Local tempo over a sliding window, for drift visualisation. */
export function tempoCurve(onsetTimes: number[], targetBpm: number, windowSize = 8): Array<{ t: number; bpm: number }> {
  const out: Array<{ t: number; bpm: number }> = [];
  const times = [...onsetTimes].sort((a, b) => a - b);
  for (let i = windowSize; i <= times.length; i += Math.max(1, Math.floor(windowSize / 2))) {
    const est = estimateTempo(times.slice(i - windowSize, i), { targetBpm, minOnsets: windowSize });
    if (est) out.push({ t: times[i - 1], bpm: est.bpm });
  }
  return out;
}
