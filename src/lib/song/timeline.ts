/**
 * Expands a song's sections into a flat, ordered list of chord events with
 * musical positions (beats). Absolute times come from an Alignment (see
 * alignment.ts) — the timeline itself never invents seconds.
 */

import { meterInfo, type TimeSignature } from "../music/meter";
import type { ChordEvent, Song, SongLine } from "./model";

export interface TimelineEvent {
  /** Stable key: section.sectionRep.line.lineRep.event */
  key: string;
  index: number;
  eventId: string;
  chord: string;
  sectionIndex: number;
  sectionId: string;
  sectionName: string;
  sectionRep: number;
  lineIndex: number;
  lineId: string;
  lineRep: number;
  startBeat: number;
  beats: number;
  /** True when the length is a heuristic guess rather than written in the sheet or set by the user. */
  estimated: boolean;
}

export interface SectionSpan {
  key: string;
  sectionIndex: number;
  sectionId: string;
  name: string;
  rep: number;
  startBeat: number;
  endBeat: number;
  firstEvent: number;
  lastEvent: number;
}

export interface Timeline {
  events: TimelineEvent[];
  sections: SectionSpan[];
  totalBeats: number;
  beatsPerBar: number;
  timeSignature: TimeSignature;
}

/**
 * Heuristic chord length when the sheet does not say: one bar per chord, or
 * half a bar when two chords sit right next to each other above the lyric
 * (e.g. "G D" squeezed over the last word of a line).
 */
export function estimateBars(line: SongLine, idx: number): number {
  const ev = line.chords[idx];
  const next = line.chords[idx + 1];
  const prev = line.chords[idx - 1];
  const close = (a: { chord: string; charIndex: number }, b: { charIndex: number }) =>
    b.charIndex - a.charIndex <= Math.max(a.chord.length + 2, 5);
  if ((next && close(ev, next)) || (prev && close(prev, ev))) return 0.5;
  return 1;
}

export function eventBars(line: SongLine, idx: number): { bars: number; estimated: boolean } {
  const ev: ChordEvent = line.chords[idx];
  if (ev.bars !== undefined && ev.bars > 0) return { bars: ev.bars, estimated: false };
  return { bars: estimateBars(line, idx), estimated: true };
}

export function buildTimeline(song: Pick<Song, "sections" | "timeSignature">): Timeline {
  const { beatsPerBar } = meterInfo(song.timeSignature);
  const events: TimelineEvent[] = [];
  const sections: SectionSpan[] = [];
  let beat = 0;

  song.sections.forEach((section, si) => {
    const hasChords = section.lines.some((l) => l.chords.length > 0);
    if (!hasChords || section.kind === "notes") return;
    const sectionReps = Math.max(1, section.repeat ?? 1);
    for (let sr = 0; sr < sectionReps; sr++) {
      const start = beat;
      const firstEvent = events.length;
      section.lines.forEach((line, li) => {
        if (line.chords.length === 0) return;
        const lineReps = Math.max(1, line.repeat ?? 1);
        for (let lr = 0; lr < lineReps; lr++) {
          line.chords.forEach((ev, ei) => {
            const { bars, estimated } = eventBars(line, ei);
            const beats = bars * beatsPerBar;
            events.push({
              key: `${si}.${sr}.${li}.${lr}.${ei}`,
              index: events.length,
              eventId: ev.id,
              chord: ev.chord,
              sectionIndex: si,
              sectionId: section.id,
              sectionName: section.name,
              sectionRep: sr,
              lineIndex: li,
              lineId: line.id,
              lineRep: lr,
              startBeat: beat,
              beats,
              estimated,
            });
            beat += beats;
          });
        }
      });
      sections.push({
        key: `${si}.${sr}`,
        sectionIndex: si,
        sectionId: section.id,
        name: section.name || "Song",
        rep: sr,
        startBeat: start,
        endBeat: beat,
        firstEvent,
        lastEvent: events.length - 1,
      });
    }
  });

  return { events, sections, totalBeats: beat, beatsPerBar, timeSignature: song.timeSignature };
}

/** Index of the event sounding at a beat position (-1 before the first event). */
export function eventIndexAtBeat(tl: Timeline, beat: number): number {
  const ev = tl.events;
  if (ev.length === 0 || beat < ev[0].startBeat) return -1;
  let lo = 0;
  let hi = ev.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ev[mid].startBeat <= beat) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Fraction of estimated (guessed) chord lengths in the timeline. */
export function estimatedShare(tl: Timeline): number {
  if (tl.events.length === 0) return 0;
  return tl.events.filter((e) => e.estimated).length / tl.events.length;
}
