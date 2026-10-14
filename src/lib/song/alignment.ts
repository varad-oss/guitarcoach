/**
 * Maps between musical position (beats) and recording time (seconds).
 *
 * A song without a recording is driven by the app's own clock at the target
 * tempo, so its beat↔time mapping is exact by construction. With a recording,
 * the mapping is only as good as its Alignment status: estimated (analysis),
 * calibrated (tap-along), or verified (user checked).
 */

import { nowIso, type Alignment, type TimingStatus } from "./model";
import type { Timeline } from "./timeline";

export interface BeatMap {
  beatToTime(beat: number): number;
  timeToBeat(time: number): number;
}

export function linearBeatMap(bpm: number, offsetSec = 0): BeatMap {
  const spb = 60 / bpm;
  return {
    beatToTime: (b) => offsetSec + b * spb,
    timeToBeat: (t) => (t - offsetSec) / spb,
  };
}

/** Beat map from a measured beat grid, extrapolating linearly at both ends. */
export function gridBeatMap(beatTimes: number[], fallbackBpm: number): BeatMap {
  if (beatTimes.length < 2) return linearBeatMap(fallbackBpm, beatTimes[0] ?? 0);
  const n = beatTimes.length;
  const firstPeriod = beatTimes[1] - beatTimes[0];
  const lastPeriod = beatTimes[n - 1] - beatTimes[n - 2];
  return {
    beatToTime(b) {
      if (b <= 0) return beatTimes[0] + b * firstPeriod;
      if (b >= n - 1) return beatTimes[n - 1] + (b - (n - 1)) * lastPeriod;
      const i = Math.floor(b);
      return beatTimes[i] + (b - i) * (beatTimes[i + 1] - beatTimes[i]);
    },
    timeToBeat(t) {
      if (t <= beatTimes[0]) return (t - beatTimes[0]) / firstPeriod;
      if (t >= beatTimes[n - 1]) return n - 1 + (t - beatTimes[n - 1]) / lastPeriod;
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (beatTimes[mid] <= t) lo = mid;
        else hi = mid;
      }
      return lo + (t - beatTimes[lo]) / (beatTimes[hi] - beatTimes[lo]);
    },
  };
}

export function beatMapFor(al: Pick<Alignment, "bpm" | "offsetSec" | "beatTimes">): BeatMap {
  if (al.beatTimes && al.beatTimes.length >= 2) return gridBeatMap(al.beatTimes, al.bpm);
  return linearBeatMap(al.bpm, al.offsetSec);
}

export interface EventTime {
  start: number;
  end: number;
  /** True when the user placed this chord change by hand. */
  manual: boolean;
}

/** Absolute start/end times for every timeline event under an alignment. */
export function eventTimes(tl: Timeline, al: Pick<Alignment, "bpm" | "offsetSec" | "beatTimes" | "eventTimes">): EventTime[] {
  const map = beatMapFor(al);
  const out: EventTime[] = tl.events.map((e) => {
    const manual = al.eventTimes?.[e.key];
    return { start: manual ?? map.beatToTime(e.startBeat), end: 0, manual: manual !== undefined };
  });
  // Keep the sequence monotonic even if manual edits conflict with the grid.
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].start + 0.05) {
      if (out[i].manual && !out[i - 1].manual) out[i - 1].start = Math.max(0, out[i].start - 0.05);
      else out[i].start = out[i - 1].start + 0.05;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].end = next ? next.start : map.beatToTime(tl.events[i].startBeat + tl.events[i].beats);
    if (out[i].end <= out[i].start) out[i].end = out[i].start + 0.05;
  }
  return out;
}

export function eventIndexAtTime(times: EventTime[], t: number): number {
  if (times.length === 0 || t < times[0].start) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function defaultAlignment(bpm: number): Alignment {
  return { status: "none", bpm, offsetSec: 0, methods: ["default"], updatedAt: nowIso() };
}

export interface TapFit {
  bpm: number;
  /** Time of the first tapped beat after fitting. */
  offsetSec: number;
  /** RMS deviation of taps from the fitted grid, in milliseconds. */
  residualMs: number;
  taps: number;
}

/**
 * Fits a steady beat grid to tap times (one tap per beat). Missed taps are
 * tolerated by snapping each tap to the nearest beat index. Needs at least
 * four taps and rejects grids the taps do not support.
 */
export function fitTaps(taps: number[], minTaps = 4): TapFit | null {
  if (taps.length < minTaps) return null;
  const t = [...taps].sort((a, b) => a - b);
  const iois = t.slice(1).map((x, i) => x - t[i]).filter((d) => d > 0.15 && d < 2.5);
  if (iois.length < minTaps - 1) return null;
  const sorted = [...iois].sort((a, b) => a - b);
  const period0 = sorted[Math.floor(sorted.length / 2)];
  const idx = t.map((x) => Math.round((x - t[0]) / period0));
  // Least squares t = a + b * idx
  const n = t.length;
  const mx = idx.reduce((a, b) => a + b, 0) / n;
  const my = t.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (idx[i] - mx) ** 2;
    sxy += (idx[i] - mx) * (t[i] - my);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (t[i] - (a + b * idx[i])) ** 2;
  const residual = Math.sqrt(ss / n);
  if (residual > b * 0.2) return null;
  return { bpm: 60 / b, offsetSec: a, residualMs: residual * 1000, taps: n };
}

export function statusLabel(status: TimingStatus): string {
  return {
    none: "No timing yet",
    estimated: "Estimated timing",
    calibrated: "Calibrated timing",
    verified: "Verified timing",
  }[status];
}

/** Whether millisecond timing feedback is meaningful under this alignment. */
export function supportsMsTiming(status: TimingStatus | "clock"): boolean {
  return status === "clock" || status === "calibrated" || status === "verified";
}
