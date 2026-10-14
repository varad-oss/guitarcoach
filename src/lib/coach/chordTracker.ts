/**
 * Live chord display with temporal smoothing: an exponential average of chroma
 * (reset on each new strum so changes register quickly) plus hysteresis, so a
 * single noisy frame never flips the displayed chord.
 */

import { chordsCompatible, transposeChord } from "../music/chords";
import { rankChords, type Candidate } from "../dsp/chordTemplates";

export interface AnalysisFrame {
  /** Time on the audio clock (s). */
  time: number;
  rmsDb: number;
  tonal: boolean;
  chroma: ArrayLike<number>;
  bassPc: number;
}

export type Clarity = "high" | "medium" | "low";

export interface LiveDetection {
  state: "silent" | "unclear" | "chord";
  /** Displayed chord in shape terms (capo removed). */
  chord?: string;
  clarity?: Clarity;
  candidates: Candidate[];
  time: number;
}

export const SILENCE_DB = -52;

export class ChordTracker {
  private ema: Float64Array | null = null;
  private stable: string | null = null;
  private pending: string | null = null;
  private pendingCount = 0;
  private unclearCount = 0;
  constructor(
    private capo = 0,
    private holdFrames = 3,
    private alpha = 0.45,
  ) {}

  setCapo(c: number): void {
    this.capo = c;
  }

  /** Call when a new strum is detected so the average restarts. */
  onset(): void {
    this.ema = null;
  }

  push(f: AnalysisFrame): LiveDetection {
    if (f.rmsDb < SILENCE_DB) {
      this.unclearCount++;
      if (this.unclearCount > 6) this.stable = null;
      return { state: "silent", candidates: [], time: f.time };
    }
    if (!f.tonal) {
      this.unclearCount++;
      if (this.unclearCount > 8) this.stable = null;
      return { state: "unclear", candidates: [], time: f.time, chord: this.stable ? this.display(this.stable) : undefined };
    }
    this.unclearCount = 0;
    if (!this.ema) this.ema = Float64Array.from(f.chroma);
    else for (let i = 0; i < 12; i++) this.ema[i] = (1 - this.alpha) * this.ema[i] + this.alpha * f.chroma[i];

    const ranked = rankChords(this.ema, f.bassPc);
    const top = ranked[0];
    if (top.symbol === this.pending) this.pendingCount++;
    else {
      this.pending = top.symbol;
      this.pendingCount = 1;
    }
    if (!this.stable || (this.pendingCount >= this.holdFrames && !chordsCompatible(this.stable, this.pending))) {
      if (!this.stable && this.pendingCount < 2) {
        return { state: "unclear", candidates: ranked.slice(0, 4), time: f.time };
      }
      this.stable = this.pending;
    } else if (this.pendingCount >= this.holdFrames) {
      this.stable = this.pending;
    }
    const current = ranked.find((c) => c.symbol === this.stable) ?? top;
    const rival = ranked.find((c) => !chordsCompatible(this.stable!, c.symbol));
    const margin = current.score - (rival?.score ?? 0);
    const clarity: Clarity = current.score > 0.7 && margin > 0.12 ? "high" : current.score > 0.55 && margin > 0.05 ? "medium" : "low";
    return {
      state: "chord",
      chord: this.display(this.stable!),
      clarity,
      candidates: ranked.slice(0, 4).map((c) => ({ ...c, symbol: this.display(c.symbol) })),
      time: f.time,
    };
  }

  private display(sounding: string): string {
    return this.capo ? transposeChord(sounding, -this.capo) : sounding;
  }
}
