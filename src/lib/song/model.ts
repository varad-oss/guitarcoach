/**
 * Canonical, versioned data model. Song content is independent of where it was
 * imported from, and is kept separate from audio recordings (and their timing
 * alignment) and from practice sessions, so one song can be used with several
 * recordings without duplicating its content.
 */

import type { TimeSignature } from "../music/meter";
import type { Frets } from "../music/shapes";

export const SONG_SCHEMA_VERSION = 1 as const;

/**
 * How trustworthy a piece of timing information is.
 * - none: no timing information at all
 * - estimated: derived automatically (heuristics or audio analysis), not checked
 * - calibrated: fitted to the user's tapping or other measured evidence
 * - verified: the user reviewed and confirmed it
 */
export type TimingStatus = "none" | "estimated" | "calibrated" | "verified";

export type SectionKind =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "solo"
  | "interlude"
  | "instrumental"
  | "outro"
  | "coda"
  | "tag"
  | "hook"
  | "notes"
  | "other";

export type LineKind = "lyric" | "chords" | "tab" | "comment" | "unrecognized";

export interface ChordEvent {
  id: string;
  /** Normalised chord symbol as written (shape name when a capo is used). */
  chord: string;
  /** Column in the lyric line the chord sits above. */
  charIndex: number;
  /** Duration in bars. Undefined means "estimate it" (see timeline.ts). */
  bars?: number;
  /** True when this chord starts a bar in bar-notation lines ("| G | % |"). */
  barStart?: boolean;
}

export interface SongLine {
  id: string;
  kind: LineKind;
  lyrics: string;
  chords: ChordEvent[];
  /** Play this line N times ("x2"). */
  repeat?: number;
  /** Shown in the preview so a person can check this line. */
  flag?: string;
}

export interface SongSection {
  id: string;
  name: string;
  kind: SectionKind;
  lines: SongLine[];
  repeat?: number;
}

export interface Barre {
  fret: number;
  /** String indices, 0 = low E. */
  fromString: number;
  toString: number;
}

export interface Voicing {
  frets: Frets;
  /** Finger numbers per string (1 = index … 4 = little, null = open/muted). */
  fingers?: (number | null)[];
  barres?: Barre[];
}

export interface ChordShape extends Voicing {
  source: "sheet" | "source-site" | "library" | "user";
  /** Other ways to play the chord (e.g. from the source site's chord library). */
  alternates?: Voicing[];
}

export type StrumSlot = "D" | "U" | "-" | "x";

export interface StrumPattern {
  id: string;
  name: string;
  /** One entry per subdivision. The pattern repeats; it may be shorter or longer than a bar. */
  slots: StrumSlot[];
  /** Slots per beat (2 = eighth notes in 4/4, 3 = triplet eighths / compound). */
  slotsPerBeat: number;
  /** Slot indices played with an accent. */
  accents?: number[];
  /** Slot indices played palm-muted. */
  palmMutes?: number[];
  /** Tempo the source suggests for this pattern. */
  bpm?: number;
  /** Sections this pattern is meant for (from names like "Chorus - Alternative Pattern"). */
  sectionKinds?: SectionKind[];
  source?: "user" | "source-site";
}

export interface SourceVersion {
  url: string;
  type: string;
  version: number;
  rating?: number;
  votes?: number;
  difficulty?: string;
  key?: string;
  /** Sold by the site (e.g. "Official" / "Pro"): listed but never imported. */
  paid: boolean;
}

export interface SourceMeta {
  site: string;
  rating?: number;
  votes?: number;
  difficulty?: string;
  author?: string;
  contributors?: number;
  views?: number;
  favorites?: number;
  version?: number;
  versionType?: string;
  versionNote?: string;
  originalKey?: string;
  tuningName?: string;
  versions?: SourceVersion[];
}

/** How the song is shown and played right now; never changes the stored chords. */
export interface DisplayPrefs {
  /** Semitones to transpose the written chords. */
  transpose: number;
  /** Capo you are actually using (null = as written). */
  capo: number | null;
  simplify: boolean;
  hideChords: boolean;
}

export const DEFAULT_DISPLAY: DisplayPrefs = { transpose: 0, capo: null, simplify: false, hideChords: false };

export type SourceKind = "url" | "paste" | "file" | "audio" | "manual" | "browser-tab" | "backup";

export interface SongSource {
  kind: SourceKind;
  url?: string;
  site?: string;
  adapterId?: string;
  fileName?: string;
  importedAt: string;
}

export interface Song {
  schemaVersion: typeof SONG_SCHEMA_VERSION;
  id: string;
  title: string;
  artist: string;
  key?: string;
  capo: number;
  /** Open-string note names, low to high. */
  tuning: string[];
  tempo: {
    bpm: number | null;
    source: "sheet" | "source-site" | "audio-analysis" | "tap" | "user" | "default";
    status: TimingStatus;
  };
  timeSignature: TimeSignature;
  sections: SongSection[];
  chordShapes: Record<string, ChordShape>;
  strumPatterns: StrumPattern[];
  /** Whether chord lengths are heuristic guesses or have been checked by the user. */
  structureTiming: TimingStatus;
  source: SongSource;
  parse: { confidence: number; warnings: string[] } | null;
  /** Extra information from the import source (ratings, versions, …). */
  sourceMeta?: SourceMeta;
  display?: DisplayPrefs;
  notes?: string;
  /** Set once the user edits the song after import; protects it from reimport overwrites. */
  userModified: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt?: string;
  lastPosition?: { recordingId: string | null; time: number };
  activeRecordingId?: string | null;
}

export interface Alignment {
  status: TimingStatus;
  bpm: number;
  /** Recording time (seconds) where beat 0 of the song timeline falls. */
  offsetSec: number;
  /** Optional measured beat grid: beatTimes[i] is the time of timeline beat i. */
  beatTimes?: number[];
  /** Per-event manual start times (seconds), keyed by timeline event key. */
  eventTimes?: Record<string, number>;
  methods: Array<"default" | "analysis" | "tap" | "manual">;
  updatedAt: string;
}

export interface AudioAnalysisSummary {
  bpm: number | null;
  bpmConfidence: number;
  beatTimes: number[];
  firstDownbeat: number | null;
  analysedAt: string;
}

export interface Recording {
  id: string;
  songId: string;
  /** "file": your own audio stored on this device. "youtube": a video played through YouTube's player. */
  kind?: "file" | "youtube";
  youtubeId?: string;
  name: string;
  mimeType: string;
  size: number;
  durationSec: number;
  createdAt: string;
  analysis?: AudioAnalysisSummary;
  alignment: Alignment;
}

export interface AudioBlobRecord {
  id: string;
  blob: Blob;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = ""): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return prefix ? `${prefix}_${raw}` : raw;
}

export const DEFAULT_BPM = 90;

export function createEmptySong(partial: Partial<Song> = {}): Song {
  const t = nowIso();
  return {
    schemaVersion: SONG_SCHEMA_VERSION,
    id: newId("song"),
    title: "",
    artist: "",
    capo: 0,
    tuning: ["E", "A", "D", "G", "B", "E"],
    tempo: { bpm: null, source: "default", status: "none" },
    timeSignature: { numerator: 4, denominator: 4 },
    sections: [],
    chordShapes: {},
    strumPatterns: [],
    structureTiming: "estimated",
    source: { kind: "manual", importedAt: t },
    parse: null,
    userModified: false,
    favorite: false,
    createdAt: t,
    updatedAt: t,
    activeRecordingId: null,
    ...partial,
  };
}

/** The BPM to use when nothing better is known. */
export function effectiveBpm(song: Pick<Song, "tempo">): number {
  return song.tempo.bpm && song.tempo.bpm > 20 ? song.tempo.bpm : DEFAULT_BPM;
}

/** Every distinct chord used in the song, in order of first appearance. */
export function uniqueChords(song: Pick<Song, "sections">): string[] {
  const seen = new Set<string>();
  for (const s of song.sections) for (const l of s.lines) for (const c of l.chords) seen.add(c.chord);
  return [...seen];
}

export function chordEventCount(song: Pick<Song, "sections">): number {
  let n = 0;
  for (const s of song.sections) for (const l of s.lines) n += l.chords.length;
  return n;
}

export function sectionKindFromName(name: string): SectionKind {
  const n = name.toLowerCase().replace(/[^a-z ]/g, " ").trim();
  if (/^pre ?chorus|^prechorus|^build|^lift/.test(n)) return "pre-chorus";
  if (/^post ?chorus/.test(n)) return "chorus";
  if (/^intro/.test(n)) return "intro";
  if (/^verse|^strophe|^v\b/.test(n)) return "verse";
  if (/^chorus|^refrain|^ch\b/.test(n)) return "chorus";
  if (/^bridge|^middle/.test(n)) return "bridge";
  if (/solo/.test(n)) return "solo";
  if (/^interlude|^break/.test(n)) return "interlude";
  if (/^instrumental/.test(n)) return "instrumental";
  if (/^outro|^ending|^end\b/.test(n)) return "outro";
  if (/^coda/.test(n)) return "coda";
  if (/^tag/.test(n)) return "tag";
  if (/^hook/.test(n)) return "hook";
  return "other";
}

/** Normalised "title|artist" key used for duplicate detection. */
export function songFingerprint(title: string, artist: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/\b(chords?|tabs?|ver(sion)?\s*\d+)\b/g, " ")
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${clean(title)}|${clean(artist)}`;
}
