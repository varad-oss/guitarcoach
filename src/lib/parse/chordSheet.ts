/**
 * Parser for plain-text chord sheets (chords printed above lyrics), including
 * the "[ch]G[/ch]" / "[tab]" markup that Ultimate Guitar uses.
 */

import { normaliseChord } from "../music/chords";
import { newId, sectionKindFromName, type ChordShape, type SongLine, type SongSection } from "../song/model";
import {
  analyseChordLine,
  chordLineToEvents,
  computeConfidence,
  isSeparator,
  isTabLine,
  isTuningLegend,
  makeLine,
  matchChordDefinition,
  matchHeader,
  matchMeta,
  parseInlineChords,
  type ChordLineAnalysis,
  type ParsedSheet,
  type SheetFormat,
} from "./common";

interface PreLine {
  text: string;
  /** Chord tokens explicitly marked as chords by the source ([ch] markup). */
  markedChords?: Array<{ col: number; chord: string }>;
  /** Every non-space character on the line was inside [ch] markup. */
  allMarked?: boolean;
}

export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => expandTabs(l).replace(/\s+$/, ""))
    .join("\n");
}

function expandTabs(line: string, width = 4): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const ch of line) {
    if (ch === "\t") out += " ".repeat(width - (out.length % width));
    else out += ch;
  }
  return out;
}

/** Strips [tab]/[ch] markup while remembering which tokens were marked as chords. */
export function preprocessUgMarkup(text: string): PreLine[] {
  return text.split("\n").map((raw) => {
    const line = raw.replace(/\[\/?tab\]/g, "");
    if (!line.includes("[ch]")) return { text: line };
    let plain = "";
    const marked: Array<{ col: number; chord: string }> = [];
    const re = /\[ch\](.*?)\[\/ch\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      plain += line.slice(last, m.index);
      marked.push({ col: plain.length, chord: m[1] });
      plain += m[1];
      last = m.index + m[0].length;
    }
    plain += line.slice(last);
    const outside = line.replace(/\[ch\].*?\[\/ch\]/g, "").replace(/[\s|%/().x\d-]/gi, "");
    return { text: plain.replace(/\s+$/, ""), markedChords: marked, allMarked: outside.length === 0 };
  });
}

type Classified =
  | { type: "blank" }
  | { type: "header"; name: string; repeat?: number; trailing?: ChordLineAnalysis; trailingOffset?: number }
  | { type: "meta"; meta: NonNullable<ReturnType<typeof matchMeta>> }
  | { type: "definition"; chord: string; shape: ChordShape; note: string }
  | { type: "chords"; analysis: ChordLineAnalysis }
  | { type: "inline"; lyrics: string; chords: SongLine["chords"] }
  | { type: "tab" }
  | { type: "comment" }
  | { type: "repeatOnly"; count: number }
  | { type: "repeatSection"; kind: string }
  | { type: "lyric" };

function classify(pre: PreLine): Classified {
  const line = pre.text;
  if (!line.trim()) return { type: "blank" };
  if (pre.allMarked && pre.markedChords?.length) {
    // The source marked these tokens as chords; trust it even for unusual symbols.
    const analysis = analyseChordLine(line);
    const marked = new Set(pre.markedChords.map((c) => c.col));
    for (const t of analysis.tokens) if (marked.has(t.col)) t.kind = "chord";
    analysis.isChordLine = true;
    analysis.ambiguous = false;
    analysis.unknownWords = [];
    return { type: "chords", analysis };
  }
  const header = matchHeader(line);
  if (header) {
    return {
      type: "header",
      name: header.name,
      repeat: header.repeat,
      trailing: header.trailing ? analyseChordLine(" ".repeat(header.trailing.offset) + header.trailing.text) : undefined,
    };
  }
  const rep = /^\s*\(?\s*repeat\s+(intro|verse|pre-?chorus|chorus|bridge|outro)\b[^)]*\)?\s*$/i.exec(line);
  if (rep) return { type: "repeatSection", kind: rep[1].toLowerCase() };
  const countOnly = /^\s*\(?\s*(?:x\s?(\d{1,2})|(\d{1,2})\s?x)\s*\)?\s*$/i.exec(line);
  if (countOnly) return { type: "repeatOnly", count: Number(countOnly[1] ?? countOnly[2]) };
  if (isSeparator(line) || isTuningLegend(line)) return { type: "comment" };
  const def = matchChordDefinition(line);
  if (def) return { type: "definition", chord: def.chord, shape: { frets: def.frets, source: "sheet" }, note: def.note };
  if (isTabLine(line)) return { type: "tab" };
  const meta = matchMeta(line);
  if (meta) return { type: "meta", meta };
  const inline = parseInlineChords(line);
  if (inline) {
    if (inline.lyrics.trim() === "") {
      // "[G] [C] [D]" — a chord-only line written with inline brackets.
      return { type: "chords", analysis: analyseChordLine(inline.chords.map((c) => c.chord).join("  ")) };
    }
    return { type: "inline", lyrics: inline.lyrics, chords: inline.chords };
  }
  const analysis = analyseChordLine(line);
  if (analysis.isChordLine) return { type: "chords", analysis };
  return { type: "lyric" };
}

export function parseChordSheet(input: string, format: SheetFormat = "text"): ParsedSheet {
  const pre = preprocessUgMarkup(normaliseText(input));
  const classified = pre.map(classify);

  const result: ParsedSheet = {
    sections: [],
    chordShapes: {},
    warnings: [],
    confidence: 0,
    stats: { chordEvents: 0, contentLines: 0, flaggedLines: 0, format },
  };

  let section: SongSection = { id: newId(), name: "", kind: "other", lines: [] };
  const pushSection = () => {
    if (section.lines.length > 0 || section.name) result.sections.push(section);
  };

  for (let i = 0; i < classified.length; i++) {
    const c = classified[i];
    const raw = pre[i].text;
    if (c.type !== "blank") result.stats.contentLines++;

    switch (c.type) {
      case "blank":
        break;
      case "header": {
        pushSection();
        section = { id: newId(), name: c.name, kind: sectionKindFromName(c.name), lines: [], repeat: c.repeat };
        if (c.trailing) {
          const { events, repeat } = chordLineToEvents(c.trailing);
          section.lines.push(makeLine({ kind: "chords", chords: events, repeat }));
        }
        break;
      }
      case "repeatSection": {
        const kind = sectionKindFromName(c.kind);
        const source = [...result.sections, section].reverse().find((s) => s.kind === kind && s.lines.some((l) => l.chords.length));
        if (source) {
          pushSection();
          section = {
            id: newId(),
            name: source.name.replace(/\s*\d+$/, ""),
            kind,
            lines: source.lines.map((l) => ({ ...l, id: newId(), chords: l.chords.map((ch) => ({ ...ch, id: newId() })) })),
          };
        } else {
          section.lines.push(makeLine({ kind: "comment", lyrics: raw.trim() }));
        }
        break;
      }
      case "repeatOnly": {
        const prev = section.lines[section.lines.length - 1];
        if (prev && prev.chords.length) prev.repeat = c.count;
        else section.lines.push(makeLine({ kind: "comment", lyrics: raw.trim() }));
        break;
      }
      case "meta": {
        const { kind, value } = c.meta;
        if (kind === "capo") result.capo = value as number;
        else if (kind === "key") result.key = value as string;
        else if (kind === "bpm") result.bpm = value as number;
        else if (kind === "time") result.timeSignature = value as ParsedSheet["timeSignature"];
        else if (kind === "tuning") result.tuning = value as string[];
        else if (kind === "title") result.title ??= value as string;
        else if (kind === "artist") result.artist ??= value as string;
        section.lines.push(makeLine({ kind: "comment", lyrics: raw.trim() }));
        break;
      }
      case "definition":
        result.chordShapes[c.chord] ??= c.shape;
        section.lines.push(makeLine({ kind: "comment", lyrics: raw.trim() }));
        break;
      case "tab":
        section.lines.push(makeLine({ kind: "tab", lyrics: raw }));
        break;
      case "comment":
        if (!isSeparator(raw)) section.lines.push(makeLine({ kind: "comment", lyrics: raw.trim() }));
        break;
      case "inline":
        section.lines.push(makeLine({ kind: "lyric", lyrics: c.lyrics, chords: c.chords }));
        break;
      case "chords": {
        const { events, repeat } = chordLineToEvents(c.analysis);
        const flag = c.analysis.ambiguous
          ? `Not sure about: ${c.analysis.unknownWords.join(", ")}. These were not read as chords.`
          : undefined;
        const next = classified[i + 1];
        if (next && next.type === "lyric") {
          const lyrics = pre[i + 1].text;
          section.lines.push(makeLine({ kind: "lyric", lyrics: lyrics.replace(/\s+$/, ""), chords: events, repeat, flag }));
          result.stats.contentLines++;
          i++;
        } else {
          section.lines.push(makeLine({ kind: "chords", chords: events, repeat, flag }));
        }
        break;
      }
      case "lyric": {
        const words = raw.trim().split(/\s+/);
        const looksLikeChords = words.length <= 3 && words.some((w) => /^[A-G][#b]?(maj|sus|add|dim|aug|m?\d)/.test(w));
        section.lines.push(
          makeLine({
            kind: "lyric",
            lyrics: raw.replace(/\s+$/, ""),
            flag: looksLikeChords ? "This line looks a bit like chords but was read as lyrics." : undefined,
          }),
        );
        break;
      }
    }
  }
  pushSection();

  finaliseSections(result);
  return result;
}

/** Marks note-only sections, counts chords and flags, and computes confidence. */
export function finaliseSections(result: ParsedSheet): void {
  let chordEvents = 0;
  let flagged = 0;
  // Sections before the first one with chords are preamble (tuning notes, chord charts, explanations).
  const firstWithChords = result.sections.findIndex((s) => s.lines.some((l) => l.chords.length > 0));
  result.sections.forEach((s, i) => {
    if (firstWithChords > 0 && i < firstWithChords) s.kind = "notes";
  });
  for (const s of result.sections) {
    const events = s.lines.reduce((n, l) => n + l.chords.length, 0);
    chordEvents += events;
    flagged += s.lines.filter((l) => l.flag).length;
    const hasLyrics = s.lines.some((l) => l.kind === "lyric" && l.lyrics.trim());
    if (events === 0 && (!s.name || !hasLyrics) && s.kind === "other") s.kind = "notes";
    else if (events === 0 && !hasLyrics) s.kind = "notes";
  }
  // Normalise chord-shape keys so lookups by event chord work.
  const shapes: Record<string, ChordShape> = {};
  for (const [k, v] of Object.entries(result.chordShapes)) shapes[normaliseChord(k)] = v;
  result.chordShapes = shapes;

  result.stats.chordEvents = chordEvents;
  result.stats.flaggedLines = flagged;
  const named = result.sections.some((s) => s.name && s.kind !== "notes");
  result.confidence = computeConfidence(result.stats.contentLines, flagged, chordEvents, named);
  if (chordEvents === 0) result.warnings.push("No chords were recognised. Check that chords are on their own lines above the lyrics.");
  if (flagged > 0) result.warnings.push(`${flagged} line${flagged === 1 ? "" : "s"} need${flagged === 1 ? "s" : ""} a quick check.`);
  if (!named && chordEvents > 0) result.warnings.push("No section headings were found, so the song is treated as one section.");
}
