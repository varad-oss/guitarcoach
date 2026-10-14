/**
 * Pitch-class (chroma) features from a magnitude spectrum, built from spectral
 * peaks rather than raw bins so noise between partials contributes little.
 */

export interface ChromaFrame {
  chroma: Float64Array;
  /** Pitch class of the lowest strong partial (a hint for the bass note), or -1. */
  bassPc: number;
  /** Number of tonal peaks used. */
  peaks: number;
  /** Sum of peak weights before normalisation (tonal energy). */
  energy: number;
  /** 0..1, how concentrated the chroma is (1 = a single pitch class). */
  focus: number;
  /** Share of spectral power (in range) that sits in tonal peaks; low for noise. */
  tonalRatio: number;
}

/** Whether a frame holds enough pitched sound to judge a chord at all. */
export function isTonal(f: Pick<ChromaFrame, "peaks" | "tonalRatio">): boolean {
  return f.peaks >= 3 && f.tonalRatio >= 0.35;
}

export interface ChromaOptions {
  sampleRate: number;
  fftSize: number;
  a4?: number;
  minHz?: number;
  maxHz?: number;
}

export function chromaFromSpectrum(mag: Float64Array, opts: ChromaOptions): ChromaFrame {
  const { sampleRate: sr, fftSize: n } = opts;
  const a4 = opts.a4 ?? 440;
  const binHz = sr / n;
  const kMin = Math.max(2, Math.floor((opts.minHz ?? 70) / binHz));
  const kMax = Math.min(mag.length - 2, Math.ceil((opts.maxHz ?? 2400) / binHz));
  const chroma = new Float64Array(12);

  let maxMag = 0;
  for (let k = kMin; k <= kMax; k++) if (mag[k] > maxMag) maxMag = mag[k];
  if (maxMag <= 0) return { chroma, bassPc: -1, peaks: 0, energy: 0, focus: 0, tonalRatio: 0 };
  let totalPower = 0;
  for (let k = kMin; k <= kMax; k++) totalPower += mag[k] * mag[k];
  let peakPower = 0;
  const floor = maxMag * 0.006; // ≈ -44 dB below the strongest partial

  // Local mean for peak salience.
  const half = Math.max(4, Math.round(25 / binHz));
  const prefix = new Float64Array(mag.length + 1);
  for (let k = 0; k < mag.length; k++) prefix[k + 1] = prefix[k] + mag[k];

  let peaks = 0;
  let energy = 0;
  let bassPc = -1;
  let bassFreq = Infinity;
  let bassAmp = 0;
  let lowMax = 0;
  for (let k = kMin; k <= kMax; k++) if (k * binHz < 450 && mag[k] > lowMax) lowMax = mag[k];

  for (let k = kMin; k <= kMax; k++) {
    const m = mag[k];
    if (m < floor || m <= mag[k - 1] || m < mag[k + 1]) continue;
    const lo = Math.max(0, k - half);
    const hi = Math.min(mag.length - 1, k + half);
    const localMean = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    if (m < localMean * 1.8) continue;

    // Parabolic interpolation on log magnitude.
    const a = Math.log(mag[k - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(mag[k + 1] + 1e-12);
    const denom = a - 2 * b + c;
    const delta = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    const freq = (k + delta) * binHz;
    const amp = Math.exp(b - 0.25 * (a - c) * delta);

    const midi = 69 + 12 * Math.log2(freq / a4);
    const nearest = Math.round(midi);
    const dev = Math.abs(midi - nearest);
    if (dev > 0.42) continue;
    const tuningWeight = 1 - (dev / 0.5) ** 2;
    const w = Math.pow(amp / maxMag, 0.6) * tuningWeight;
    const pc = ((nearest % 12) + 12) % 12;
    peakPower += mag[k - 1] * mag[k - 1] + m * m + mag[k + 1] * mag[k + 1];
    chroma[pc] += w;
    energy += w;
    peaks++;

    if (freq < 330 && amp > lowMax * 0.3 && freq < bassFreq) {
      bassFreq = freq;
      bassPc = pc;
      bassAmp = amp;
    }
  }
  void bassAmp;

  let norm = 0;
  for (let i = 0; i < 12; i++) norm += chroma[i] * chroma[i];
  norm = Math.sqrt(norm);
  let focus = 0;
  if (norm > 0) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      chroma[i] /= norm;
      sum += chroma[i];
    }
    // L2/L1 based concentration: 1 for one class, ~0.29 for flat.
    focus = (1 / Math.max(sum, 1e-9) - 1 / Math.sqrt(12)) / (1 - 1 / Math.sqrt(12));
    focus = Math.max(0, Math.min(1, focus));
  }
  return { chroma, bassPc, peaks, energy, focus, tonalRatio: totalPower > 0 ? Math.min(1, peakPower / totalPower) : 0 };
}

export function addChroma(acc: Float64Array, c: Float64Array, w = 1): void {
  for (let i = 0; i < 12; i++) acc[i] += c[i] * w;
}

export function normaliseChroma(c: Float64Array): Float64Array {
  let n = 0;
  for (let i = 0; i < 12; i++) n += c[i] * c[i];
  n = Math.sqrt(n);
  const out = new Float64Array(12);
  if (n > 0) for (let i = 0; i < 12; i++) out[i] = c[i] / n;
  return out;
}
