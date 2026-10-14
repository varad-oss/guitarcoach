import { normaliseChord, parseChord } from "../music/chords";
import { parseTimeSignature, type TimeSignature } from "../music/meter";
import { parseFretString, type Frets } from "../music/shapes";
import { newId, type ChordEvent, type ChordShape, type SongLine, type SongSection } from "../song/model";

export type SheetFormat = "text" | "chordpro" | "ug";

export interface ParsedSheet {
  title?: string;
  artist?: string;
  key?: string;
  capo?: number;
  bpm?: number;
  timeSignature?: TimeSignature;
  tuning?: string[];
  sections: SongSection[];
  chordShapes: Record<string, ChordShape>;
  warnings: string[];
  /** 0..1 — how much of the input was understood without guesswork. */
  confidence: number;
  stats: { chordEvents: number; contentLines: number; flaggedLines: number; format: SheetFormat };
}

export interface Token {
  text: string;
  col: number;
}

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const re = /\|+:?|:?\|+|[^\s|]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], col: m.index });
  return out;
}

export type TokenKind = "chord" | "bar" | "repeatBar" | "beatSlash" | "count" | "nc" | "paren" | "word";

export function classifyToken(t: string): TokenKind {
  if (/^:?\|+:?$/.test(t)) return "bar";
  if (t === "%") return "repeatBar";
  if (/^[/.\-–]+$/.test(t)) return "beatSlash";
  if (/^\(?\s*(?:x\s?\d{1,2}|\d{1,2}\s?x)\s*\)?$/i.test(t)) return "count";
  if (/^\(?n\.?c\.?\)?$/i.test(t)) return "nc";
  if (/^[()]$/.test(t)) return "paren";
  if (parseChord(t)) return "chord";
  // Chords glued to punctuation: "G," "(Am" "C)".
  const stripped = t.replace(/^[(\[]+|[)\],;:*]+$/g, "");
  if (stripped !== t && stripped && parseChord(stripped)) return "chord";
  return "word";
}

export function cleanChordToken(t: string): string {
  return normaliseChord(t.replace(/^[(\[]+|[)\],;:*]+$/g, "") || t);
}

export function repeatCountOf(t: string): number | null {
  const m = /(\d{1,2})/.exec(t);
  return m ? Math.max(1, Math.min(16, Number(m[1]))) : null;
}

export interface ChordLineAnalysis {
  isChordLine: boolean;
  ambiguous: boolean;
  unknownWords: string[];
  tokens: Array<Token & { kind: TokenKind }>;
}

export function analyseChordLine(line: string): ChordLineAnalysis {
  const tokens = tokenize(line).map((t) => ({ ...t, kind: classifyToken(t.text) }));
  const chords = tokens.filter((t) => t.kind === "chord").length;
  const words = tokens.filter((t) => t.kind === "word");
  if (chords === 0) return { isChordLine: false, ambiguous: false, unknownWords: [], tokens };
  if (words.length === 0) return { isChordLine: true, ambiguous: false, unknownWords: [], tokens };
  const ratio = chords / (chords + words.length);
  const shortWords = words.every((w) => w.text.length <= 8);
  if (ratio >= 0.6 && shortWords) {
    return { isChordLine: true, ambiguous: true, unknownWords: words.map((w) => w.text), tokens };
  }
  return { isChordLine: false, ambiguous: false, unknownWords: [], tokens };
}

/**
 * Builds chord events from an analysed chord line. Handles bar notation
 * ("| G | % | C D |") including beat slashes ("G / C /") and repeat-bar "%".
 */
export function chordLineToEvents(analysis: ChordLineAnalysis): { events: ChordEvent[]; repeat?: number } {
  const toks = analysis.tokens;
  let repeat: number | undefined;
  const usesBars = toks.some((t) => t.kind === "bar" || t.kind === "repeatBar");

  if (!usesBars) {
    const events: ChordEvent[] = [];
    for (const t of toks) {
      if (t.kind === "chord") events.push({ id: newId(), chord: cleanChordToken(t.text), charIndex: t.col });
      else if (t.kind === "count") repeat = repeatCountOf(t.text) ?? undefined;
    }
    // "G / / / C / / /" without bar lines: beat slashes give relative lengths.
    const slashes = toks.filter((t) => t.kind === "beatSlash" && /^\/+$/.test(t.text)).length;
    if (slashes > 0 && events.length > 0) {
      const counts: number[] = [];
      for (const t of toks) {
        if (t.kind === "chord") counts.push(1);
        else if (t.kind === "beatSlash" && /^\/+$/.test(t.text) && counts.length) counts[counts.length - 1] += t.text.length;
      }
      // Assume 4 beat-slots per bar; the timeline rescales to the song's meter.
      events.forEach((e, i) => (e.bars = counts[i] / 4));
    }
    return { events, repeat };
  }

  // Split into bars.
  const bars: Array<Array<Token & { kind: TokenKind }>> = [];
  let current: Array<Token & { kind: TokenKind }> = [];
  for (const t of toks) {
    if (t.kind === "bar") {
      if (current.length) bars.push(current);
      current = [];
    } else if (t.kind === "count") {
      repeat = repeatCountOf(t.text) ?? undefined;
    } else current.push(t);
  }
  if (current.length) bars.push(current);

  const events: ChordEvent[] = [];
  let previousBar: string[] = [];
  for (const bar of bars) {
    const chordsInBar = bar.filter((t) => t.kind === "chord");
    const isRepeat = bar.some((t) => t.kind === "repeatBar") && chordsInBar.length === 0;
    if (isRepeat) {
      const col = bar.find((t) => t.kind === "repeatBar")!.col;
      previousBar.forEach((c, i) =>
        events.push({ id: newId(), chord: c, charIndex: col + i, bars: 1 / previousBar.length, barStart: i === 0 }),
      );
      continue;
    }
    if (chordsInBar.length === 0) continue;
    const slotCounts: number[] = [];
    for (const t of bar) {
      if (t.kind === "chord") slotCounts.push(1);
      else if (t.kind === "beatSlash" && slotCounts.length) slotCounts[slotCounts.length - 1] += t.text.length;
    }
    const totalSlots = slotCounts.reduce((a, b) => a + b, 0);
    chordsInBar.forEach((t, i) =>
      events.push({
        id: newId(),
        chord: cleanChordToken(t.text),
        charIndex: t.col,
        bars: slotCounts[i] / totalSlots,
        barStart: i === 0,
      }),
    );
    previousBar = chordsInBar.map((t) => cleanChordToken(t.text));
  }
  return { events, repeat };
}

export function makeLine(partial: Partial<SongLine> & { kind: SongLine["kind"] }): SongLine {
  return { id: newId(), lyrics: "", chords: [], ...partial };
}

/** Extracts inline "[G]word" chords. Returns null if the line has no valid inline chords. */
export function parseInlineChords(line: string): { lyrics: string; chords: ChordEvent[] } | null {
  if (!/\[[^\]]+\]/.test(line)) return null;
  const chords: ChordEvent[] = [];
  let lyrics = "";
  let i = 0;
  let valid = true;
  const re = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    lyrics += line.slice(i, m.index);
    const sym = m[1].trim();
    if (!parseChord(sym)) {
      valid = false;
      break;
    }
    chords.push({ id: newId(), chord: normaliseChord(sym), charIndex: lyrics.length });
    i = m.index + m[0].length;
  }
  if (!valid || chords.length === 0) return null;
  lyrics += line.slice(i);
  // Keep chords that share a position (e.g. "[G][D]") readable by nudging them apart.
  for (let k = 1; k < chords.length; k++) {
    const prev = chords[k - 1];
    const minPos = prev.charIndex + prev.chord.length + 1;
    if (chords[k].charIndex < minPos && lyrics.slice(prev.charIndex).trim() === "") {
      chords[k].charIndex = minPos;
    }
  }
  return { lyrics: lyrics.replace(/\s+$/, ""), chords };
}

const SECTION_WORDS =
  "intro|verse|pre[- ]?chorus|prechorus|chorus|refrain|bridge|middle 8|middle eight|solo|guitar solo|interlude|instrumental|break|breakdown|outro|ending|coda|tag|hook|post[- ]?chorus|riff|turnaround|vamp";

const PLAIN_HEADER = new RegExp(
  `^\\s*((?:${SECTION_WORDS})(?:\\s*\\d{1,2})?(?:\\s+[a-d](?![a-z0-9]))?)\\s*(\\(?\\s*(?:x\\s?\\d{1,2}|\\d{1,2}\\s?x)\\s*\\)?)?\\s*(:)?\\s*(.*)$`,
  "i",
);

export interface HeaderMatch {
  name: string;
  repeat?: number;
  /** Text after the header on the same line, if it is a chord line. */
  trailing?: { text: string; offset: number };
}

export function matchHeader(line: string): HeaderMatch | null {
  const bracket = /^\s*\[([^\]]{1,48})\]\s*(.*)$/.exec(line);
  if (bracket && !parseChord(bracket[1].trim())) {
    let name = bracket[1].trim();
    let repeat: number | undefined;
    const rep = /\s*\(?\s*(?:x\s?(\d{1,2})|(\d{1,2})\s?x)\s*\)?\s*$/i.exec(name);
    if (rep) {
      repeat = Number(rep[1] ?? rep[2]);
      name = name.slice(0, rep.index).trim();
    }
    const rest = bracket[2];
    if (!rest.trim()) return { name, repeat };
    const trailingRep = /^\(?\s*(?:x\s?(\d{1,2})|(\d{1,2})\s?x)\s*\)?$/i.exec(rest.trim());
    if (trailingRep) return { name, repeat: Number(trailingRep[1] ?? trailingRep[2]) };
    const a = analyseChordLine(rest);
    if (a.isChordLine) return { name, repeat, trailing: { text: rest, offset: line.length - rest.length } };
    return null;
  }
  const m = PLAIN_HEADER.exec(line);
  if (!m) return null;
  const name = m[1].trim();
  const repeat = m[2] ? repeatCountOf(m[2]) ?? undefined : undefined;
  const colon = !!m[3];
  const rest = m[4] ?? "";
  if (!rest.trim()) {
    // "Verse 1", "Chorus x2", "Bridge:" — but not "Bridge over troubled water".
    return { name: titleCase(name), repeat };
  }
  if (colon || /^\s*$/.test(line.slice(0, line.indexOf(m[1])))) {
    const a = analyseChordLine(rest);
    if (a.isChordLine && !a.ambiguous) {
      return { name: titleCase(name), repeat, trailing: { text: rest, offset: line.length - rest.length } };
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export interface MetaMatch {
  kind: "capo" | "key" | "bpm" | "time" | "tuning" | "title" | "artist";
  value: string | number | string[] | TimeSignature;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

export function matchMeta(line: string): MetaMatch | null {
  const t = line.trim();
  if (t.length > 90) return null;
  let m = /^capo\s*[:\-]?\s*(?:on\s+)?(?:(?:the\s+)?fret\s*)?(\d{1,2}|[ivx]{1,4})(?:st|nd|rd|th)?\b/i.exec(t);
  if (m) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : ROMAN[m[1].toLowerCase()] ?? NaN;
    if (Number.isFinite(v) && v >= 0 && v <= 12) return { kind: "capo", value: v };
  }
  if (/^(?:no\s+capo|capo\s*[:\-]?\s*(?:none|no|0|off))\b/i.test(t)) return { kind: "capo", value: 0 };
  m = /^key\s*(?:of)?\s*[:\-]?\s*([A-G][#b♯♭]?m?)\b/i.exec(t);
  if (m && parseChord(m[1])) return { kind: "key", value: normaliseChord(m[1]) };
  m = /^(?:tempo|bpm)\s*[:\-=]?\s*(\d{2,3})\b/i.exec(t) ?? /^(\d{2,3})\s*bpm\b/i.exec(t);
  if (m) {
    const v = Number(m[1]);
    if (v >= 30 && v <= 300) return { kind: "bpm", value: v };
  }
  m = /^(?:time(?:\s*signature)?|meter)\s*[:\-]?\s*(\d{1,2}\s*\/\s*\d{1,2})/i.exec(t);
  if (m) {
    const ts = parseTimeSignature(m[1]);
    if (ts) return { kind: "time", value: ts };
  }
  m = /^tuning\s*[:\-]\s*(.+)$/i.exec(t);
  if (m) {
    const tuning = parseTuning(m[1]);
    if (tuning) return { kind: "tuning", value: tuning };
  }
  m = /^(?:title|song)\s*:\s*(.+)$/i.exec(t);
  if (m) return { kind: "title", value: m[1].trim() };
  m = /^(?:artist|by|band)\s*:\s*(.+)$/i.exec(t);
  if (m) return { kind: "artist", value: m[1].trim() };
  return null;
}

export function parseTuning(s: string): string[] | null {
  const t = s.trim();
  if (/^(e\s*)?standard\b/i.test(t)) return ["E", "A", "D", "G", "B", "E"];
  if (/^half[- ]step down|^eb standard|^e♭ standard/i.test(t)) return ["Eb", "Ab", "Db", "Gb", "Bb", "Eb"];
  if (/^drop\s*d\b/i.test(t)) return ["D", "A", "D", "G", "B", "E"];
  const spaced = t.split(/[\s,\-]+/).filter(Boolean);
  if (spaced.length === 6 && spaced.every((n) => /^[A-Ga-g][#b]?$/.test(n))) {
    return spaced.map((n) => n[0].toUpperCase() + n.slice(1));
  }
  const compact = t.match(/[A-Ga-g][#b]?/g);
  if (compact && compact.length === 6 && compact.join("").length === t.replace(/\s/g, "").length) {
    return compact.map((n) => n[0].toUpperCase() + n.slice(1));
  }
  return null;
}

/** "G  3-x-0-0-3(3)", "C: x32010", "Dsus4 x-x-0-2-3-3 or ..." */
export function matchChordDefinition(line: string): { chord: string; frets: Frets; note: string } | null {
  const m = /^\s*([^\s:=]+)\s*[:=]?\s+(.*)$/.exec(line);
  if (!m || !parseChord(m[1])) return null;
  const rest = m[2].trim();
  const first = rest.split(/\s+/)[0] ?? "";
  let frets = parseFretString(first);
  let consumed = first.length;
  if (!frets) {
    const six = rest.split(/\s+/).slice(0, 6);
    if (six.length === 6) {
      frets = parseFretString(six.join(" "));
      consumed = rest.indexOf(six[5]) + six[5].length;
    }
  }
  if (!frets) return null;
  return { chord: normaliseChord(m[1]), frets, note: rest.slice(consumed).trim() };
}

export function isTuningLegend(line: string): boolean {
  return /^\s*[EADGBe][#b]?(?:\s*[-\s]\s*[EADGBe][#b]?){5}\s*$/.test(line);
}

export function isTabLine(line: string): boolean {
  const t = line.trim();
  if (/^[a-gA-G][#b]?\s*[|:]?[-–0-9hpbrsvx~/\\|().\s*^]*-{2,}[-–0-9hpbrsvx~/\\|().\s*^]*\|?\s*$/.test(t)) return true;
  if (/^\|?[-–0-9hpbrsvx~/\\|().]{8,}\|?$/.test(t) && /-{3,}/.test(t) && /\d/.test(t)) return true;
  return false;
}

export function isSeparator(line: string): boolean {
  return /^\s*[-=_*~#.]{4,}\s*$/.test(line);
}

export function computeConfidence(contentLines: number, flagged: number, chordEvents: number, hasSections: boolean): number {
  if (contentLines === 0) return 0;
  let c = 1 - (flagged / contentLines) * 1.5;
  if (chordEvents === 0) c = Math.min(c, 0.15);
  else if (chordEvents < 3) c = Math.min(c, 0.5);
  if (!hasSections) c *= 0.92;
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}
