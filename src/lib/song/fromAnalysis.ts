/**
 * Builds an estimated song structure from recording analysis. Everything here
 * is marked as estimated; the person reviews it before relying on it.
 */

import type { FileAnalysis } from "../dsp/fileAnalysis";
import { newId, nowIso, type Alignment, type AudioAnalysisSummary, type ChordEvent, type SongSection } from "./model";

export function sectionsFromAnalysis(a: FileAnalysis, beatsPerBar: number): SongSection[] {
  // Expand segments into per-beat labels starting at the first downbeat.
  const labels: Array<string | null> = [];
  for (const s of a.segments) for (let i = 0; i < s.beats; i++) labels[s.startBeat + i] = s.chord;
  const nBars = Math.floor(labels.length / beatsPerBar);
  if (nBars === 0) return [];
  const sectionDefs = a.sections.length ? a.sections : [{ label: "A", startBar: 0, endBar: nBars }];
  const seen = new Map<string, number>();
  const out: SongSection[] = [];

  for (const def of sectionDefs) {
    const count = (seen.get(def.label) ?? 0) + 1;
    seen.set(def.label, count);
    const section: SongSection = {
      id: newId(),
      name: sectionDefs.length > 1 ? `Section ${def.label}${count > 1 ? ` (${count})` : ""}` : "Estimated chords",
      kind: "other",
      lines: [],
    };
    for (let lineStart = def.startBar; lineStart < Math.min(def.endBar, nBars); lineStart += 4) {
      const chords: ChordEvent[] = [];
      let col = 0;
      for (let bar = lineStart; bar < Math.min(lineStart + 4, def.endBar, nBars); bar++) {
        let barStart = true;
        let b = bar * beatsPerBar;
        const end = b + beatsPerBar;
        while (b < end) {
          const chord = labels[b] ?? null;
          let len = 1;
          while (b + len < end && (labels[b + len] ?? null) === chord) len++;
          if (chord) {
            chords.push({ id: newId(), chord, charIndex: col, bars: len / beatsPerBar, barStart });
            col += chord.length + 2;
            barStart = false;
          } else if (chords.length) {
            // A stretch with no clear chord extends the previous chord.
            chords[chords.length - 1].bars = (chords[chords.length - 1].bars ?? 0) + len / beatsPerBar;
          } else {
            chords.push({ id: newId(), chord: "N.C.", charIndex: col, bars: len / beatsPerBar, barStart });
            col += 6;
            barStart = false;
          }
          b += len;
        }
      }
      // A line made only of "no chord" is dropped from the chord structure but kept as a rest.
      const cleaned = chords.filter((c) => c.chord !== "N.C.");
      if (cleaned.length === 0) {
        if (chords.length) section.lines.push({ id: newId(), kind: "comment", lyrics: "(no clear chord)", chords: [] });
        continue;
      }
      // Leading "no chord" time is folded into the first real chord so timing stays in place.
      if (chords[0].chord === "N.C.") {
        cleaned[0].bars = (cleaned[0].bars ?? 0) + (chords[0].bars ?? 0);
        cleaned[0].barStart = true;
      }
      section.lines.push({ id: newId(), kind: "chords", lyrics: "", chords: cleaned });
    }
    if (section.lines.length) out.push(section);
  }
  return out;
}

export function alignmentFromAnalysis(a: FileAnalysis, fallbackBpm: number, startBeatIndex = a.downbeatIndex): Alignment {
  const beatTimes = a.beatTimes.slice(startBeatIndex);
  return {
    status: a.bpm ? "estimated" : "none",
    bpm: a.bpm ?? fallbackBpm,
    offsetSec: beatTimes[0] ?? 0,
    beatTimes: beatTimes.length >= 2 ? beatTimes.map((t) => Math.round(t * 1000) / 1000) : undefined,
    methods: ["analysis"],
    updatedAt: nowIso(),
  };
}

export function analysisSummary(a: FileAnalysis): AudioAnalysisSummary {
  return {
    bpm: a.bpm,
    bpmConfidence: Math.round(a.bpmConfidence * 100) / 100,
    beatTimes: a.beatTimes.map((t) => Math.round(t * 1000) / 1000),
    firstDownbeat: a.beatTimes[a.downbeatIndex] ?? null,
    analysedAt: nowIso(),
  };
}
