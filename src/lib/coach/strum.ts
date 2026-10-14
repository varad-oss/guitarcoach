import { newId, type StrumPattern, type StrumSlot } from "../song/model";

/**
 * Parses strumming notation. Accepted forms:
 * - slot notation with rests: "D - D U - U D U" (one symbol per subdivision)
 * - compact: "D-DU-UDU"
 * - the common shorthand "D D U U D U", which is ambiguous without rests and is
 *   read as the standard pattern D - D U - U D U.
 * Returns null if the text is not a pattern.
 */
export function parsePattern(text: string, slotsPerBar: number): StrumSlot[] | null {
  const t = text.trim().toUpperCase().replace(/[|,]/g, " ");
  if (!t) return null;
  let tokens = t.includes(" ") ? t.split(/\s+/) : t.split("");
  tokens = tokens.map((x) => (x === "_" || x === "." || x === "–" ? "-" : x === "X" ? "x" : x));
  if (!tokens.every((x) => ["D", "U", "-", "x"].includes(x))) return null;
  if (!tokens.includes("-") && tokens.join(" ") === "D D U U D U" && slotsPerBar === 8) {
    return ["D", "-", "D", "U", "-", "U", "D", "U"];
  }
  if (tokens.length > slotsPerBar) return null;
  const slots = tokens as StrumSlot[];
  while (slots.length < slotsPerBar) slots.push("-");
  return slots;
}

export function formatPattern(slots: StrumSlot[]): string {
  return slots.join(" ");
}

/** Counting labels for each slot: "1 & 2 &" or "1 & a 2 & a". `slotCount` may differ from a bar. */
export function slotLabels(beatsPerBar: number, slotsPerBeat: number, slotCount = beatsPerBar * slotsPerBeat): string[] {
  const spb = Math.max(1, Math.round(slotsPerBeat));
  const sub = spb === 2 ? ["&"] : spb === 3 ? ["&", "a"] : spb === 4 ? ["e", "&", "a"] : spb === 6 ? ["", "&", "", "a", ""] : Array(spb - 1).fill("");
  const out: string[] = [];
  for (let i = 0; i < slotCount; i++) {
    const beat = Math.floor(i / spb);
    const pos = i % spb;
    out.push(pos === 0 ? String((beat % Math.max(1, beatsPerBar)) + 1) : sub[pos - 1] ?? "");
  }
  return out;
}

/** Which slot of a repeating pattern is current at a beat position (from the start of the song). */
export function slotAtBeat(beat: number, slotsPerBeat: number, length: number): number {
  if (beat < 0 || length === 0) return -1;
  return ((Math.floor(beat * slotsPerBeat + 1e-6) % length) + length) % length;
}

/** Picks the pattern for a section: one written for that section, else the main one. */
export function patternForSection<T extends { sectionKinds?: string[] }>(patterns: T[], kind: string | undefined): T | undefined {
  if (!patterns.length) return undefined;
  return (kind ? patterns.find((p) => p.sectionKinds?.includes(kind)) : undefined) ?? patterns.find((p) => !p.sectionKinds?.length) ?? patterns[0];
}

export const PRESET_PATTERNS: Array<{ name: string; slots: string; slotsPerBeat: number; beats: number }> = [
  { name: "Down on every beat", slots: "D - D - D - D -", slotsPerBeat: 2, beats: 4 },
  { name: "Eighth notes", slots: "D U D U D U D U", slotsPerBeat: 2, beats: 4 },
  { name: "Folk pattern", slots: "D - D U - U D U", slotsPerBeat: 2, beats: 4 },
  { name: "Waltz (3/4)", slots: "D - D U D U", slotsPerBeat: 2, beats: 3 },
  { name: "Compound feel (12/8)", slots: "D - U D - U D - U D - U", slotsPerBeat: 3, beats: 4 },
  { name: "6/8 ballad", slots: "D - U D U U", slotsPerBeat: 3, beats: 2 },
];

export function makePattern(name: string, slots: StrumSlot[], slotsPerBeat: number): StrumPattern {
  return { id: newId("pat"), name, slots, slotsPerBeat };
}
