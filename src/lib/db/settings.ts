export interface Settings {
  version: 1;
  /** Reference pitch for the tuner and chord analysis. */
  a4: number;
  /** Measured round-trip latency (speaker → ear → strum → microphone), ms. */
  latencyMs: number | null;
  latencyMeasuredAt?: string;
  micDeviceId?: string;
  timing: {
    /** |offset| at or below this counts as on time. */
    onTimeMs: number;
    /** Strums further than this from the change are not matched to it. */
    windowMs: number;
  };
  fontScale: number;
  largeChords: boolean;
  followMode: boolean;
  showDiagrams: boolean;
  metronome: {
    volume: number;
    accent: boolean;
    subdivisions: boolean;
    countInBars: number;
  };
  playbackVolume: number;
  disabledAdapters: string[];
  storageNoticeDismissed: boolean;
  theme: "dark" | "light";
  /** Use templates learned from the player's own calibration takes. */
  usePersonalCalibration: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  a4: 440,
  latencyMs: null,
  timing: { onTimeMs: 70, windowMs: 350 },
  fontScale: 1,
  largeChords: false,
  followMode: true,
  showDiagrams: true,
  metronome: { volume: 0.7, accent: true, subdivisions: false, countInBars: 1 },
  playbackVolume: 0.9,
  disabledAdapters: [],
  storageNoticeDismissed: false,
  theme: "dark",
  usePersonalCalibration: true,
};

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    timing: { ...DEFAULT_SETTINGS.timing, ...(s?.timing ?? {}) },
    metronome: { ...DEFAULT_SETTINGS.metronome, ...(s?.metronome ?? {}) },
    version: 1,
  };
}
