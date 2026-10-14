import type { TimingStatus } from "../song/model";

export type PracticeMode =
  | "learn"
  | "chord-drill"
  | "rhythm-drill"
  | "full-song"
  | "performance"
  | "free-play"
  | "transition";

export const MODE_LABELS: Record<PracticeMode, string> = {
  learn: "Learn",
  "chord-drill": "Chord drill",
  "rhythm-drill": "Rhythm drill",
  "full-song": "Full song",
  performance: "Performance",
  "free-play": "Free play",
  transition: "Chord changes",
};

/** Whether the played chord matched, as far as the audio evidence allows. */
export type ChordVerdict = "correct" | "wrong" | "uncertain" | "missed" | "not-evaluated";
export type TimingVerdict = "early" | "on-time" | "late" | "missed" | "unknown";

export interface ChordResult {
  key: string;
  index: number;
  expected: string;
  sectionName: string;
  sectionIndex: number;
  lineIndex: number;
  /** Song time (seconds) of the expected change. */
  expectedTime: number;
  verdict: ChordVerdict;
  detected?: string;
  /** 0..1 evidence strength for the verdict. */
  confidence?: number;
  timing: TimingVerdict;
  /** Strum onset minus expected change, in ms (negative = early). Only when measurable. */
  offsetMs?: number;
}

export interface StrumStats {
  evaluated: boolean;
  expected: number;
  matched: number;
  missed: number;
  extra: number;
  meanAbsOffsetMs: number | null;
  stdOffsetMs: number | null;
}

export interface TempoStats {
  targetBpm: number;
  estimatedBpm: number | null;
  /** Coefficient of variation of beat intervals, as a percentage (lower is steadier). */
  driftPct: number | null;
  onsetCount: number;
  samples: Array<{ t: number; bpm: number }>;
}

export interface TransitionStat {
  from: string;
  to: string;
  attempts: number;
  successes: number;
  /** Measured change times in ms (silence/mess between the two chords). */
  times: number[];
}

export interface SessionSummary {
  chordTotal: number;
  chordEvaluated: number;
  correct: number;
  wrong: number;
  missed: number;
  uncertain: number;
  /** correct / (correct + wrong + missed), null when nothing could be evaluated. */
  chordAccuracy: number | null;
  timingEvaluated: number;
  onTime: number;
  early: number;
  late: number;
  timingAccuracy: number | null;
  meanAbsOffsetMs: number | null;
  strumConsistency: number | null;
  tempoDriftPct: number | null;
}

export interface PracticeSession {
  id: string;
  songId: string | null;
  songTitle: string;
  songArtist: string;
  recordingId: string | null;
  mode: PracticeMode;
  startedAt: string;
  endedAt: string;
  /** Seconds spent actually playing (transport running). */
  activeSec: number;
  speed: number;
  bpm: number;
  /** "clock" = the app's own metronome timeline (exact); otherwise the recording's alignment status. */
  timingSource: "clock" | TimingStatus;
  micUsed: boolean;
  /** Share of analysed audio frames with a usable signal. */
  signalQuality: number | null;
  range?: { startBeat: number; endBeat: number; label: string };
  chordResults: ChordResult[];
  strum?: StrumStats;
  tempo?: TempoStats;
  transitions?: TransitionStat[];
  summary: SessionSummary;
}
