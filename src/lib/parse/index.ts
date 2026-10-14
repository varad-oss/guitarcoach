import { parseChordSheet } from "./chordSheet";
import { looksLikeChordPro, parseChordPro } from "./chordpro";
import type { ParsedSheet, SheetFormat } from "./common";

export type { ParsedSheet, SheetFormat } from "./common";

export function detectFormat(text: string): SheetFormat {
  if (/\[ch\].*?\[\/ch\]/.test(text) || /\[tab\]/.test(text)) return "ug";
  if (looksLikeChordPro(text)) return "chordpro";
  return "text";
}

/** Parses any supported text format into the canonical section structure. */
export function parseSongText(text: string, format: SheetFormat | "auto" = "auto"): ParsedSheet {
  const f = format === "auto" ? detectFormat(text) : format;
  if (f === "chordpro") return parseChordPro(text);
  return parseChordSheet(text, f);
}

/** Removes UG markup so the text can be shown and edited as a plain chord sheet. */
export function stripSourceMarkup(text: string): string {
  return text.replace(/\[\/?tab\]/g, "").replace(/\[ch\](.*?)\[\/ch\]/g, "$1");
}
