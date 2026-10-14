import type { ParsedSheet } from "../parse/common";
import { normaliseChord } from "../music/chords";
import {
  createEmptySong,
  nowIso,
  songFingerprint,
  type Song,
  type SongSection,
  type SongSource,
} from "./model";

export interface SongMeta {
  title?: string;
  artist?: string;
  key?: string;
  capo?: number;
  bpm?: number | null;
  bpmSource?: Song["tempo"]["source"];
  source: SongSource;
  extraShapes?: Song["chordShapes"];
}

/** Creates a canonical Song from parsed sheet content plus import metadata. */
export function songFromParsed(parsed: ParsedSheet, meta: SongMeta): Song {
  const bpm = parsed.bpm ?? meta.bpm ?? null;
  return createEmptySong({
    title: (meta.title ?? parsed.title ?? "").trim() || "Untitled song",
    artist: (meta.artist ?? parsed.artist ?? "").trim(),
    key: parsed.key ?? meta.key,
    capo: parsed.capo ?? meta.capo ?? 0,
    tuning: parsed.tuning ?? ["E", "A", "D", "G", "B", "E"],
    tempo: {
      bpm,
      source: parsed.bpm ? "sheet" : meta.bpm ? meta.bpmSource ?? "source-site" : "default",
      status: bpm ? "estimated" : "none",
    },
    timeSignature: parsed.timeSignature ?? { numerator: 4, denominator: 4 },
    sections: parsed.sections,
    chordShapes: { ...(meta.extraShapes ?? {}), ...parsed.chordShapes },
    source: meta.source,
    parse: { confidence: parsed.confidence, warnings: parsed.warnings },
    structureTiming: "estimated",
  });
}

export interface DuplicateMatch {
  song: Song;
  reason: "same-source" | "same-title-artist";
}

export function findDuplicates(candidate: Pick<Song, "title" | "artist" | "source">, library: Song[]): DuplicateMatch[] {
  const fp = songFingerprint(candidate.title, candidate.artist);
  const url = candidate.source.url ? normaliseUrlForCompare(candidate.source.url) : null;
  const out: DuplicateMatch[] = [];
  for (const s of library) {
    if (url && s.source.url && normaliseUrlForCompare(s.source.url) === url) out.push({ song: s, reason: "same-source" });
    else if (fp !== "|" && songFingerprint(s.title, s.artist) === fp) out.push({ song: s, reason: "same-title-artist" });
  }
  return out;
}

function normaliseUrlForCompare(u: string): string {
  try {
    const url = new URL(u);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/**
 * After the sheet text is edited and re-parsed, keep user-set chord lengths
 * where the same chord still sits in the same section/line/position.
 */
export function carryOverDurations(oldSections: SongSection[], newSections: SongSection[]): SongSection[] {
  return newSections.map((ns, si) => {
    const os = oldSections[si];
    if (!os || os.name !== ns.name) return ns;
    return {
      ...ns,
      lines: ns.lines.map((nl, li) => {
        const ol = os.lines[li];
        if (!ol) return nl;
        return {
          ...nl,
          chords: nl.chords.map((nc, ci) => {
            const oc = ol.chords[ci];
            if (oc && normaliseChord(oc.chord) === normaliseChord(nc.chord) && oc.bars !== undefined && nc.bars === undefined) {
              return { ...nc, bars: oc.bars };
            }
            return nc;
          }),
        };
      }),
    };
  });
}

/** Returns a copy marked as edited by the user. */
export function markEdited(song: Song): Song {
  return { ...song, userModified: true, updatedAt: nowIso() };
}
