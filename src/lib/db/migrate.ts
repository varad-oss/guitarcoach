import { createEmptySong, SONG_SCHEMA_VERSION, type Song } from "../song/model";

/**
 * Upgrades songs stored by older versions of the app. Version 1 is the first
 * schema; this fills in any missing fields so newer code can rely on them.
 */
export function migrateSong(raw: unknown): Song {
  const s = raw as Partial<Song> & { schemaVersion?: number };
  if (!s || typeof s !== "object" || typeof s.id !== "string") throw new Error("Not a song record");
  if ((s.schemaVersion ?? 1) > SONG_SCHEMA_VERSION) {
    throw new Error("This song was saved by a newer version of GuitarCoach.");
  }
  const base = createEmptySong({ id: s.id });
  const sections = Array.isArray(s.sections) ? s.sections : [];
  // Chordless sections before the first chords are preamble notes (older imports didn't mark them).
  const firstWithChords = sections.findIndex((sec) => sec.lines?.some((l) => l.chords?.length > 0));
  const normalised = firstWithChords > 0 ? sections.map((sec, i) => (i < firstWithChords && sec.kind !== "notes" ? { ...sec, kind: "notes" as const } : sec)) : sections;
  return {
    ...base,
    ...s,
    schemaVersion: SONG_SCHEMA_VERSION,
    tempo: { ...base.tempo, ...(s.tempo ?? {}) },
    timeSignature: s.timeSignature ?? base.timeSignature,
    sections: normalised,
    chordShapes: s.chordShapes ?? {},
    strumPatterns: s.strumPatterns ?? [],
    source: s.source ?? base.source,
  } as Song;
}
