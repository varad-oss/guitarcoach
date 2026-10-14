/**
 * Chord-change trainer: watches the stable live detection and measures how long
 * each change from chord A to chord B takes. A change only counts when both
 * chords were clearly heard; unclear audio produces no score at all.
 */

import { chordsCompatible } from "../music/chords";
import type { LiveDetection } from "./chordTracker";

export interface TransitionEvent {
  from: string;
  to: string;
  /** Time between the last clear frame of `from` and the first clear frame of `to`. */
  gapMs: number;
  ok: boolean;
  at: number;
}

export class TransitionTracker {
  private lastChord: string | null = null;
  private lastChordTime = 0;
  private strayChord: string | null = null;
  readonly events: TransitionEvent[] = [];

  constructor(
    readonly a: string,
    readonly b: string,
  ) {}

  push(d: LiveDetection): TransitionEvent | null {
    if (d.state !== "chord" || !d.chord || d.clarity === "low") return null;
    const which = chordsCompatible(this.a, d.chord) ? this.a : chordsCompatible(this.b, d.chord) ? this.b : null;
    if (!which) {
      if (d.clarity === "high") this.strayChord = d.chord;
      return null;
    }
    let ev: TransitionEvent | null = null;
    if (this.lastChord && which !== this.lastChord) {
      ev = {
        from: this.lastChord,
        to: which,
        gapMs: Math.round((d.time - this.lastChordTime) * 1000),
        ok: this.strayChord === null,
        at: d.time,
      };
      this.events.push(ev);
    }
    if (which !== this.lastChord || ev) this.strayChord = null;
    this.lastChord = which;
    this.lastChordTime = d.time;
    return ev;
  }

  stats(): { attempts: number; successes: number; meanMs: number | null; sdMs: number | null; perMinute: number | null } {
    const ok = this.events.filter((e) => e.ok);
    const times = ok.map((e) => e.gapMs);
    const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const sd = times.length >= 3 && mean !== null ? Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length) : null;
    const span = this.events.length >= 2 ? this.events[this.events.length - 1].at - this.events[0].at : 0;
    return {
      attempts: this.events.length,
      successes: ok.length,
      meanMs: mean === null ? null : Math.round(mean),
      sdMs: sd === null ? null : Math.round(sd),
      perMinute: span > 5 ? Math.round(((ok.length - 1) / span) * 60) : null,
    };
  }
}
