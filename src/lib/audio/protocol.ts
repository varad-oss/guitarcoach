/** Messages between the main thread and the analysis worker. */

export type AnalysisMode = "chords" | "tuner";

export type ToWorker =
  | { type: "init"; sampleRate: number; mode: AnalysisMode; a4: number; port?: MessagePort }
  | { type: "mode"; mode: AnalysisMode }
  | { type: "a4"; a4: number }
  | { type: "audio"; samples: Float32Array; frame: number };

export interface FrameMsg {
  type: "frame";
  /** Audio-clock time at the centre of the analysis window. */
  time: number;
  rmsDb: number;
  tonal: boolean;
  tonalRatio: number;
  chroma: number[];
  bassPc: number;
}

export interface OnsetMsg {
  type: "onset";
  time: number;
  strength: number;
}

export interface PitchMsg {
  type: "pitch";
  time: number;
  freq: number | null;
  confidence: number;
  rmsDb: number;
}

export interface LevelMsg {
  type: "level";
  time: number;
  rmsDb: number;
}

export type FromWorker = FrameMsg | OnsetMsg | PitchMsg | LevelMsg | { type: "ready" };
