/**
 * ChordPro parser (https://www.chordpro.org/chordpro/). Supports metadata
 * directives, section environments, {comment} section labels, {chorus} recall,
 * {define} chord shapes, tab and grid environments, and inline [Chord] lyrics.
 */

import { normaliseChord, parseChord } from "../music/chords";
import { parseTimeSignature } from "../music/meter";
import { parseFretString } from "../music/shapes";
import { newId, sectionKindFromName, type SectionKind, type SongSection } from "../song/model";
import { analyseChordLine, chordLineToEvents, makeLine, matchHeader, parseInlineChords, parseTuning, type ParsedSheet } from "./common";
import { finaliseSections, normaliseText } from "./chordSheet";

const ENV_KIND: Record<string, { kind: SectionKind | "tab" | "grid"; label: string }> = {
  start_of_chorus: { kind: "chorus", label: "Chorus" },
  soc: { kind: "chorus", label: "Chorus" },
  start_of_verse: { kind: "verse", label: "Verse" },
  sov: { kind: "verse", label: "Verse" },
  start_of_bridge: { kind: "bridge", label: "Bridge" },
  sob: { kind: "bridge", label: "Bridge" },
  start_of_tab: { kind: "tab", label: "Tab" },
  sot: { kind: "tab", label: "Tab" },
  start_of_grid: { kind: "grid", label: "Grid" },
  sog: { kind: "grid", label: "Grid" },
};

export function looksLikeChordPro(text: string): boolean {
  if (/^\s*\{\s*(title|t|start_of_\w+|soc|sov|artist|subtitle|st|key|capo|tempo|comment|c)\s*[:}]/im.test(text)) return true;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return false;
  const inline = lines.filter((l) => {
    const r = parseInlineChords(l);
    return r && r.lyrics.trim().length > 0;
  }).length;
  return inline >= 2 && inline / lines.length >= 0.25;
}

export function parseChordPro(input: string): ParsedSheet {
  const lines = normaliseText(input).split("\n");
  const result: ParsedSheet = {
    sections: [],
    chordShapes: {},
    warnings: [],
    confidence: 0,
    stats: { chordEvents: 0, contentLines: 0, flaggedLines: 0, format: "chordpro" },
  };

  let section: SongSection = { id: newId(), name: "", kind: "other", lines: [] };
  let env: "tab" | "grid" | null = null;
  let lastChorus: SongSection | null = null;
  const push = () => {
    if (section.lines.length || section.name) result.sections.push(section);
    if (section.kind === "chorus" && section.lines.length) lastChorus = section;
  };
  const startSection = (name: string, kind: SectionKind) => {
    push();
    section = { id: newId(), name, kind, lines: [] };
  };

  for (const raw of lines) {
    const line = raw;
    if (!line.trim()) continue;
    result.stats.contentLines++;
    if (/^\s*#/.test(line)) {
      result.stats.contentLines--;
      continue;
    }

    const dir = /^\s*\{\s*([a-zA-Z_]+)(?:-[a-z]+)?\s*(?:[:\s]\s*(.*?))?\s*\}\s*$/.exec(line);
    if (dir) {
      const name = dir[1].toLowerCase();
      const value = (dir[2] ?? "").trim();
      if (ENV_KIND[name]) {
        const e = ENV_KIND[name];
        if (e.kind === "tab" || e.kind === "grid") {
          env = e.kind;
          if (value) section.lines.push(makeLine({ kind: "comment", lyrics: value }));
        } else {
          startSection(value || e.label, e.kind);
        }
        continue;
      }
      if (/^(end_of_\w+|eoc|eov|eob|eot|eog)$/.test(name)) {
        if (env) env = null;
        else startSection("", "other");
        continue;
      }
      switch (name) {
        case "title":
        case "t":
          result.title ??= value;
          break;
        case "subtitle":
        case "st":
        case "artist":
          result.artist ??= value;
          break;
        case "key":
          if (parseChord(value)) result.key = normaliseChord(value);
          break;
        case "capo": {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0 && n <= 12) result.capo = n;
          break;
        }
        case "tempo": {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 30 && n <= 300) result.bpm = n;
          break;
        }
        case "time": {
          const ts = parseTimeSignature(value);
          if (ts) result.timeSignature = ts;
          break;
        }
        case "tuning": {
          const t = parseTuning(value);
          if (t) result.tuning = t;
          break;
        }
        case "define":
        case "chord": {
          const d = /^(\S+)\s+(?:base-fret\s+(\d+)\s+)?(?:frets\s+)?(.+?)(?:\s+fingers.*)?$/.exec(value);
          if (d && parseChord(d[1])) {
            const frets = parseFretString(d[3].trim());
            const base = d[2] ? Number(d[2]) : 1;
            if (frets) {
              result.chordShapes[normaliseChord(d[1])] = {
                frets: frets.map((f) => (f === null || f === 0 ? f : f + base - 1)),
                source: "sheet",
              };
            }
          }
          break;
        }
        case "comment":
        case "c":
        case "comment_italic":
        case "ci":
        case "comment_box":
        case "cb":
        case "highlight": {
          const h = matchHeader(value);
          if (h && !h.trailing) startSection(h.name, sectionKindFromName(h.name));
          else section.lines.push(makeLine({ kind: "comment", lyrics: value }));
          break;
        }
        case "chorus": {
          const src = lastChorus as SongSection | null;
          if (src) {
            push();
            section = {
              id: newId(),
              name: value || src.name || "Chorus",
              kind: "chorus",
              lines: src.lines.map((l) => ({ ...l, id: newId(), chords: l.chords.map((c) => ({ ...c, id: newId() })) })),
            };
            push();
            section = { id: newId(), name: "", kind: "other", lines: [] };
          } else {
            startSection(value || "Chorus", "chorus");
          }
          break;
        }
        default:
          // Unknown directive: keep it visible rather than dropping it.
          section.lines.push(makeLine({ kind: "comment", lyrics: line.trim(), flag: "Unrecognised ChordPro directive." }));
      }
      continue;
    }

    if (env === "tab") {
      section.lines.push(makeLine({ kind: "tab", lyrics: line }));
      continue;
    }
    if (env === "grid") {
      const a = analyseChordLine(line);
      if (a.isChordLine) {
        const { events, repeat } = chordLineToEvents(a);
        section.lines.push(makeLine({ kind: "chords", chords: events, repeat }));
      } else section.lines.push(makeLine({ kind: "comment", lyrics: line.trim() }));
      continue;
    }

    const inline = parseInlineChords(line);
    if (inline) {
      if (inline.lyrics.trim()) section.lines.push(makeLine({ kind: "lyric", lyrics: inline.lyrics, chords: inline.chords }));
      else {
        // Chords only: spread them out for display.
        let col = 0;
        const chords = inline.chords.map((c) => {
          const e = { ...c, charIndex: col };
          col += c.chord.length + 2;
          return e;
        });
        section.lines.push(makeLine({ kind: "chords", chords }));
      }
      continue;
    }
    const header = matchHeader(line);
    if (header && !header.trailing) {
      startSection(header.name, sectionKindFromName(header.name));
      continue;
    }
    if (/\[[^\]]*\]/.test(line)) {
      section.lines.push(makeLine({ kind: "lyric", lyrics: line, flag: "Contains something in [brackets] that is not a recognised chord." }));
      continue;
    }
    section.lines.push(makeLine({ kind: "lyric", lyrics: line.replace(/\s+$/, "") }));
  }
  push();
  finaliseSections(result);
  return result;
}
