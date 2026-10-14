/**
 * An import "draft": everything shown in the editable preview before saving.
 * The sheet text is the single source of truth; it is re-parsed on every edit.
 */

import type { TimeSignature } from "../music/meter";
import { parseSongText, stripSourceMarkup, type ParsedSheet } from "../parse";
import { songFromParsed } from "../song/build";
import { nowIso, type ChordShape, type Song, type SongSource, type SourceMeta, type StrumPattern } from "../song/model";
import type { ImportedContent, ImportResponse } from "./types";
import { checkImportUrl, makeFailure } from "./registry";

export interface Draft {
  title: string;
  artist: string;
  key: string;
  capo: number;
  bpm: number | null;
  bpmFromSource: boolean;
  timeSignature: TimeSignature | null;
  text: string;
  source: SongSource;
  hints: string[];
  shapes: Record<string, ChordShape>;
  strumPatterns: StrumPattern[];
  sourceMeta?: SourceMeta;
  /** Shown when content came from an automated extraction (PDF/OCR) and needs extra care. */
  lowConfidenceReason?: string;
}

export function emptyDraft(source: SongSource, partial: Partial<Draft> = {}): Draft {
  return {
    title: "",
    artist: "",
    key: "",
    capo: 0,
    bpm: null,
    bpmFromSource: false,
    timeSignature: null,
    text: "",
    source,
    hints: [],
    shapes: {},
    strumPatterns: [],
    ...partial,
  };
}

export function draftFromImported(c: ImportedContent, kind: SongSource["kind"] = "url"): Draft {
  const shapes: Record<string, ChordShape> = {};
  for (const [k, v] of Object.entries(c.shapes ?? {})) shapes[k] = { ...v, source: "source-site" };
  return emptyDraft(
    { kind, url: c.url, site: c.site, adapterId: c.adapterId, importedAt: nowIso() },
    {
      title: c.title ?? "",
      artist: c.artist ?? "",
      key: c.meta.key ?? "",
      capo: c.meta.capo ?? 0,
      bpm: c.meta.bpm ?? null,
      bpmFromSource: !!c.meta.bpm,
      text: c.format === "ug" ? stripSourceMarkup(c.text) : c.text,
      hints: c.hints,
      shapes,
      strumPatterns: c.strumPatterns ?? [],
      sourceMeta: c.sourceMeta,
      timeSignature: null,
    },
  );
}

/** Parses the draft text, letting explicit draft fields override what the sheet says. */
export function parseDraft(d: Draft): ParsedSheet {
  return parseSongText(d.text);
}

/** Copies metadata found inside the text (e.g. "Capo 2", "{title: …}") into empty draft fields. */
export function absorbParsedMeta(d: Draft, p: ParsedSheet): Draft {
  return {
    ...d,
    title: d.title || p.title || "",
    artist: d.artist || p.artist || "",
    key: d.key || p.key || "",
    capo: d.capo || p.capo || 0,
    bpm: d.bpm ?? p.bpm ?? null,
    timeSignature: d.timeSignature ?? p.timeSignature ?? null,
  };
}

export function draftToSong(d: Draft, parsed: ParsedSheet): Song {
  const song = songFromParsed(parsed, {
    title: d.title,
    artist: d.artist,
    source: d.source,
    bpm: d.bpm,
    bpmSource: d.bpmFromSource ? "source-site" : "user",
    extraShapes: d.shapes,
  });
  // Shapes written in the sheet win; the site's voicings for the same chord become alternates.
  const chordShapes: Song["chordShapes"] = { ...song.chordShapes };
  for (const [name, siteShape] of Object.entries(d.shapes)) {
    const sheetShape = parsed.chordShapes[name];
    if (sheetShape) {
      const alts = [siteShape, ...(siteShape.alternates ?? [])].map(({ frets, fingers, barres }) => ({ frets, fingers, barres }));
      chordShapes[name] = { ...sheetShape, alternates: alts.filter((a) => a.frets.join() !== sheetShape.frets.join()) };
    }
  }
  return {
    ...song,
    chordShapes,
    strumPatterns: d.strumPatterns,
    sourceMeta: d.sourceMeta,
    key: d.key || parsed.key || undefined,
    capo: d.capo,
    tempo: d.bpm ? { bpm: d.bpm, source: d.bpmFromSource ? "source-site" : parsed.bpm === d.bpm ? "sheet" : "user", status: "estimated" } : song.tempo,
    timeSignature: d.timeSignature ?? parsed.timeSignature ?? { numerator: 4, denominator: 4 },
    parse: { confidence: parsed.confidence, warnings: [...parsed.warnings, ...(d.lowConfidenceReason ? [d.lowConfidenceReason] : [])] },
  };
}

/** Calls the server import route. Network problems are reported, never treated as success. */
export async function requestImport(input: string, signal?: AbortSignal): Promise<ImportResponse> {
  const check = checkImportUrl(input);
  if (!check.ok) return { ok: false, error: makeFailure(check.code, check.partial ?? { url: input }) };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, error: makeFailure("offline", { url: check.url.toString(), site: check.adapter.site, ...check.adapter.partialFromUrl(check.url) }) };
  }
  try {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: check.url.toString() }),
      signal: signal ?? AbortSignal.timeout(25_000),
    });
    const data = (await res.json()) as ImportResponse;
    if (typeof data?.ok !== "boolean") throw new Error("bad response");
    return data;
  } catch {
    const partial = { url: check.url.toString(), site: check.adapter.site, ...check.adapter.partialFromUrl(check.url) };
    return { ok: false, error: makeFailure(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "network", partial) };
  }
}
