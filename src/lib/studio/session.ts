import { newId, nowIso, type TimingStatus } from "../song/model";
import { summarize } from "../coach/evaluate";
import type { ChordResult, PracticeMode, PracticeSession, StrumStats, TempoStats, TransitionStat } from "../coach/types";

export function buildSession(p: {
  songId: string | null;
  songTitle: string;
  songArtist: string;
  recordingId: string | null;
  mode: PracticeMode;
  startedAt: string;
  activeSec: number;
  speed: number;
  bpm: number;
  timingSource: "clock" | TimingStatus;
  micUsed: boolean;
  signalQuality: number | null;
  results: ChordResult[];
  strum?: StrumStats;
  tempo?: TempoStats;
  transitions?: TransitionStat[];
  range?: PracticeSession["range"];
}): PracticeSession {
  return {
    id: newId("ses"),
    songId: p.songId,
    songTitle: p.songTitle,
    songArtist: p.songArtist,
    recordingId: p.recordingId,
    mode: p.mode,
    startedAt: p.startedAt,
    endedAt: nowIso(),
    activeSec: Math.round(p.activeSec),
    speed: p.speed,
    bpm: Math.round(p.bpm * 10) / 10,
    timingSource: p.timingSource,
    micUsed: p.micUsed,
    signalQuality: p.signalQuality === null ? null : Math.round(p.signalQuality * 100) / 100,
    range: p.range,
    chordResults: p.results,
    strum: p.strum,
    tempo: p.tempo,
    transitions: p.transitions,
    summary: summarize(p.results, p.strum, p.tempo),
  };
}
