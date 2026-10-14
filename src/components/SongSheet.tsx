"use client";

import { memo, type ReactNode } from "react";
import type { ChordEvent, SongLine, SongSection } from "@/lib/song/model";
import { cx } from "./ui";

export interface SheetProps {
  sections: SongSection[];
  fontScale?: number;
  largeChords?: boolean;
  activeLineId?: string | null;
  activeEventId?: string | null;
  showFlags?: boolean;
  showNotes?: boolean;
  /** Lyrics only (chord-only lines are still shown). */
  hideChords?: boolean;
  displayChord?: (c: string) => string;
  onChordClick?: (pos: { section: number; line: number; chord: number }) => void;
  onLineClick?: (lineId: string) => void;
  /** Extra decoration rendered at the end of a line (e.g. per-line results). */
  lineAside?: (line: SongLine) => ReactNode;
}

interface Pair {
  chord?: ChordEvent;
  chordIndex?: number;
  text: string;
}

/** Splits a lyric line into chord/lyric pairs so chords stay above the right syllable while lines wrap. */
export function toPairs(line: SongLine): Pair[] {
  const lyrics = line.lyrics;
  const chords = line.chords.map((c, i) => ({ c, i })).sort((a, b) => a.c.charIndex - b.c.charIndex);
  const pairs: Pair[] = [];
  const pushWords = (text: string, first: Pair | null) => {
    // The first word stays with its chord; later words become wrap points.
    const parts = text.match(/\S+\s*|\s+/g) ?? [""];
    parts.forEach((p, i) => {
      if (i === 0 && first) pairs.push({ ...first, text: p });
      else pairs.push({ text: p });
    });
    if (parts.length === 0 && first) pairs.push({ ...first, text: "" });
  };
  const firstPos = chords.length ? Math.min(chords[0].c.charIndex, lyrics.length) : lyrics.length;
  if (firstPos > 0) pushWords(lyrics.slice(0, firstPos), null);
  chords.forEach(({ c, i }, k) => {
    const start = Math.min(c.charIndex, lyrics.length);
    const end = k + 1 < chords.length ? Math.min(chords[k + 1].c.charIndex, lyrics.length) : lyrics.length;
    const text = lyrics.slice(start, end);
    if (!text) pairs.push({ chord: c, chordIndex: i, text: "" });
    else pushWords(text, { chord: c, chordIndex: i, text: "" });
  });
  return pairs;
}

/** Pairs that split a word (chord in the middle of a syllable) must not wrap apart. */
export function groupWords(pairs: Pair[]): Pair[][] {
  const words: Pair[][] = [];
  for (const p of pairs) {
    const last = words[words.length - 1];
    const prevText = last?.[last.length - 1]?.text ?? "";
    if (!last || prevText === "" || /\s$/.test(prevText)) words.push([p]);
    else last.push(p);
  }
  return words;
}

function ChordLabel({
  ev,
  idx,
  active,
  display,
  onClick,
}: {
  ev: ChordEvent;
  idx: number;
  active: boolean;
  display: (c: string) => string;
  onClick?: (chordIndex: number) => void;
}) {
  const label = display(ev.chord);
  return (
    <span className="sheet-chord" data-active={active || undefined} data-event-id={ev.id}>
      {onClick ? (
        <button type="button" onClick={() => onClick(idx)} aria-label={`Edit chord ${label}`}>
          {label}
        </button>
      ) : (
        label
      )}
    </span>
  );
}

function Line({
  line,
  sectionIndex,
  lineIndex,
  props,
}: {
  line: SongLine;
  sectionIndex: number;
  lineIndex: number;
  props: SheetProps;
}) {
  const display = props.displayChord ?? ((c: string) => c);
  const active = props.activeLineId === line.id;
  const onChord = props.onChordClick ? (ci: number) => props.onChordClick!({ section: sectionIndex, line: lineIndex, chord: ci }) : undefined;
  const flagged = props.showFlags && !!line.flag;
  const repeat = line.repeat && line.repeat > 1 ? <span className="text-text-3 text-[0.8em] ml-2 tabular">×{line.repeat}</span> : null;

  let body: ReactNode;
  if (line.kind === "tab") body = <div className="sheet-tab scroll-thin">{line.lyrics}</div>;
  else if (line.kind === "comment" || line.kind === "unrecognized") body = <div className="sheet-comment">{line.lyrics}</div>;
  else if (line.kind === "chords" || (line.kind === "lyric" && !line.lyrics.trim())) {
    const bars = line.chords.some((c) => c.barStart);
    body = (
      <div className="sheet-chips">
        {bars && <span className="sheet-bar">|</span>}
        {line.chords.map((c, i) => (
          <span key={c.id + i} className="inline-flex items-baseline gap-[0.9em]">
            {bars && c.barStart && i > 0 && <span className="sheet-bar">|</span>}
            <ChordLabel ev={c} idx={i} active={props.activeEventId === c.id} display={display} onClick={onChord} />
          </span>
        ))}
        {bars && <span className="sheet-bar">|</span>}
        {repeat}
      </div>
    );
  } else {
    const hasChords = line.chords.length > 0 && !props.hideChords;
    body = (
      <div className="sheet-pairs">
        {groupWords(toPairs(line)).map((word, wi) => (
          <span className="sheet-word" key={wi}>
            {word.map((p, i) => (
              <span className="sheet-pair" key={i}>
                {hasChords &&
                  (p.chord ? (
                    <ChordLabel ev={p.chord} idx={p.chordIndex!} active={props.activeEventId === p.chord.id} display={display} onClick={onChord} />
                  ) : (
                    <span className="sheet-chord" aria-hidden="true" />
                  ))}
                <span className="sheet-lyric">{p.text}</span>
              </span>
            ))}
          </span>
        ))}
        {repeat}
      </div>
    );
  }

  return (
    <div
      className={cx("sheet-line", props.onLineClick && "cursor-pointer hover:bg-surface-2/60")}
      data-line-id={line.id}
      data-active={active || undefined}
      data-flag={flagged || undefined}
      onClick={props.onLineClick ? () => props.onLineClick!(line.id) : undefined}
    >
      {body}
      {flagged && <p className="text-[13px] text-warn mt-0.5 font-sans">{line.flag}</p>}
      {props.lineAside?.(line)}
    </div>
  );
}

export const SongSheet = memo(function SongSheet(props: SheetProps) {
  const { sections, fontScale = 1, largeChords, showNotes = true } = props;
  return (
    <div className={cx("sheet", largeChords && "large-chords")} style={{ ["--sheet-size" as string]: `${1.25 * fontScale}rem` }}>
      {sections.map((s, si) => {
        if (s.kind === "notes" && !showNotes) return null;
        return (
          s.kind === "notes" ? (
            <details key={s.id} className="sheet-section sheet-notes" data-section-id={s.id}>
              <summary className="sheet-heading cursor-pointer select-none">
                <span className="text-text-2 font-semibold">{s.name ? `Notes: ${s.name}` : "Notes from the sheet"}</span>
              </summary>
              {s.lines.map((l, li) => (
                <Line key={l.id} line={l} sectionIndex={si} lineIndex={li} props={props} />
              ))}
            </details>
          ) : (
          <section key={s.id} className="sheet-section" data-section-id={s.id} aria-label={s.name || "Song"}>
            {s.name && (
              <h3 className="sheet-heading">
                <span className="text-text-2 font-semibold">{s.name}</span>
                {s.repeat && s.repeat > 1 && <span className="tabular">×{s.repeat}</span>}
              </h3>
            )}
            {s.lines.map((l, li) => (
              <Line key={l.id} line={l} sectionIndex={si} lineIndex={li} props={props} />
            ))}
          </section>
          )
        );
      })}
    </div>
  );
});
