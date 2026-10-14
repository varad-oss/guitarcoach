/**
 * YIN fundamental-frequency estimation (de Cheveigné & Kawahara, 2002),
 * used by the tuner for single strings.
 */

export interface PitchEstimate {
  freq: number;
  /** 0..1 (1 - aperiodicity at the chosen lag). */
  confidence: number;
}

export function yin(frame: ArrayLike<number>, sampleRate: number, opts: { minHz?: number; maxHz?: number; threshold?: number } = {}): PitchEstimate | null {
  const minHz = opts.minHz ?? 60;
  const maxHz = opts.maxHz ?? 1100;
  const threshold = opts.threshold ?? 0.12;
  const tauMax = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const w = frame.length - tauMax;
  if (w < 64) return null;

  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = frame[i] - frame[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // Cumulative mean normalised difference.
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.35) return null;
    tau = best;
  }
  let betterTau = tau;
  if (tau > 1 && tau < tauMax) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
  }
  return { freq: sampleRate / betterTau, confidence: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function freqToMidi(f: number, a4 = 440): number {
  return 69 + 12 * Math.log2(f / a4);
}

export function midiName(m: number): string {
  const r = Math.round(m);
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

export function centsOff(f: number, targetHz: number): number {
  return 1200 * Math.log2(f / targetHz);
}

export interface TuningString {
  name: string;
  midi: number;
}

export const STANDARD_TUNING: TuningString[] = [
  { name: "E2", midi: 40 },
  { name: "A2", midi: 45 },
  { name: "D3", midi: 50 },
  { name: "G3", midi: 55 },
  { name: "B3", midi: 59 },
  { name: "E4", midi: 64 },
];

/** The string in the tuning closest to a detected frequency. */
export function nearestString(f: number, tuning: TuningString[] = STANDARD_TUNING, a4 = 440): { string: TuningString; cents: number } {
  const m = freqToMidi(f, a4);
  let best = tuning[0];
  for (const s of tuning) if (Math.abs(s.midi - m) < Math.abs(best.midi - m)) best = s;
  return { string: best, cents: (m - best.midi) * 100 };
}
