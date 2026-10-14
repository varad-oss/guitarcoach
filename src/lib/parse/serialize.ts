/**
 * Turns the canonical song structure back into text: a plain chords-over-lyrics
 * sheet (used by the text editor and .txt export) and ChordPro.
 */

import { formatTimeSignature } from "../music/meter";
import { formatFrets } from "../music/shapes";
import type { Song, SongLine, SongSection } from "../song/model";

function isBarLine(line: SongLine): boolean {
  return line.kind === "chords" && line.chords.some((c) => c.barStart);
}

function barLineText(line: SongLine): string {
  // Rebuild "| G | Em C |" with "%" for repeated bars.
  const bars: string[][] = [];
  for (const c of line.chords) {
    if (c.barStart || bars.length === 0) bars.push([]);
    bars[bars.length - 1].push(c.chord);
  }
  const parts = bars.map((b, i) => (i > 0 && b.join(" ") === bars[i - 1].join(" ") ? "%" : b.join(" ")));
  return `| ${parts.join(" | ")} |`;
}

export function chordRow(line: SongLine): string {
  let row = "";
  for (const c of line.chords) {
    const pos = Math.max(c.charIndex, row.length === 0 ? 0 : row.length + 1);
    row = row.padEnd(pos, " ") + c.chord;
  }
  return row;
}

function repeatSuffix(n?: number): string {
  return n && n > 1 ? ` x${n}` : "";
}

export function lineToText(line: SongLine): string[] {
  switch (line.kind) {
    case "chords":
      return [(isBarLine(line) ? barLineText(line) : chordRow(line)) + repeatSuffix(line.repeat)];
    case "lyric":
      if (line.chords.length === 0) return [line.lyrics];
      return [chordRow(line) + repeatSuffix(line.repeat), line.lyrics];
    default:
      return [line.lyrics];
  }
}

export function sectionToText(section: SongSection): string {
  const out: string[] = [];
  if (section.name) out.push(`[${section.name}${repeatSuffix(section.repeat)}]`);
  for (const l of section.lines) out.push(...lineToText(l));
  return out.join("\n");
}

/** Plain-text sheet of the song body (sections only). */
export function sectionsToText(sections: SongSection[]): string {
  return sections.map(sectionToText).join("\n\n");
}

/** Full plain-text export including a short metadata header. */
export function songToText(song: Song): string {
  const head: string[] = [];
  if (song.title) head.push(`Title: ${song.title}`);
  if (song.artist) head.push(`Artist: ${song.artist}`);
  if (song.key) head.push(`Key: ${song.key}`);
  if (song.capo) head.push(`Capo: ${song.capo}`);
  if (song.tempo.bpm) head.push(`Tempo: ${song.tempo.bpm}`);
  head.push(`Time: ${formatTimeSignature(song.timeSignature)}`);
  return `${head.join("\n")}\n\n${sectionsToText(song.sections)}\n`;
}

function inlineLyric(line: SongLine): string {
  if (line.kind === "chords") return line.chords.map((c) => `[${c.chord}]`).join(" ");
  let text = line.lyrics;
  const sorted = [...line.chords].sort((a, b) => b.charIndex - a.charIndex);
  for (const c of sorted) {
    if (c.charIndex > text.length) text = text.padEnd(c.charIndex, " ");
    text = text.slice(0, c.charIndex) + `[${c.chord}]` + text.slice(c.charIndex);
  }
  return text.replace(/\s+$/, "");
}

export function songToChordPro(song: Song): string {
  const out: string[] = [];
  if (song.title) out.push(`{title: ${song.title}}`);
  if (song.artist) out.push(`{artist: ${song.artist}}`);
  if (song.key) out.push(`{key: ${song.key}}`);
  if (song.capo) out.push(`{capo: ${song.capo}}`);
  if (song.tempo.bpm) out.push(`{tempo: ${song.tempo.bpm}}`);
  out.push(`{time: ${formatTimeSignature(song.timeSignature)}}`);
  for (const [name, shape] of Object.entries(song.chordShapes)) {
    out.push(`{define: ${name} base-fret 1 frets ${shape.frets.map((f) => (f === null ? "x" : f)).join(" ")}}`);
  }
  for (const s of song.sections) {
    out.push("");
    const env = s.kind === "chorus" ? "chorus" : s.kind === "verse" ? "verse" : s.kind === "bridge" ? "bridge" : null;
    if (env) out.push(`{start_of_${env}${s.name ? `: ${s.name}` : ""}}`);
    else if (s.name) out.push(`{comment: ${s.name}}`);
    for (const l of s.lines) {
      if (l.kind === "tab") out.push(l.lyrics);
      else if (l.kind === "comment") out.push(`{comment: ${l.lyrics}}`);
      else out.push(inlineLyric(l) + repeatSuffix(l.repeat));
    }
    if (env) out.push(`{end_of_${env}}`);
  }
  return out.join("\n") + "\n";
}

export { formatFrets };
