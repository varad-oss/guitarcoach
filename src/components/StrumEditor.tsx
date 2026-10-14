"use client";

import { useState } from "react";
import { Button, Field, IconButton, Input, Notice, Select, cx } from "@/components/ui";
import { updateSong } from "@/lib/db/db";
import { makePattern, parsePattern, PRESET_PATTERNS, slotLabels, formatPattern } from "@/lib/coach/strum";
import { meterInfo } from "@/lib/music/meter";
import type { Song, StrumPattern, StrumSlot } from "@/lib/song/model";

const CYCLE: StrumSlot[] = ["-", "D", "U", "x"];

export function PatternGrid({
  slots,
  slotsPerBeat,
  beatsPerBar,
  activeSlot,
  onToggle,
  size = "md",
  accents,
  palmMutes,
}: {
  slots: StrumSlot[];
  slotsPerBeat: number;
  beatsPerBar: number;
  activeSlot?: number | null;
  onToggle?: (i: number) => void;
  size?: "md" | "lg";
  accents?: number[];
  palmMutes?: number[];
}) {
  const labels = slotLabels(beatsPerBar, slotsPerBeat, slots.length);
  const spb = Math.max(1, Math.round(slotsPerBeat));
  return (
    <div className="flex flex-wrap gap-1" role={onToggle ? "group" : "img"} aria-label={`Strumming pattern ${formatPattern(slots)}`}>
      {slots.map((s, i) => {
        const onBeat = i % spb === 0;
        const accent = accents?.includes(i);
        const pm = palmMutes?.includes(i);
        const cell = (
          <>
            <span className={cx("text-[11px] tabular", onBeat ? "text-text-2" : "text-text-3")}>{accent ? ">" : labels[i] || "\u00a0"}</span>
            <span
              className={cx(
                "chord-face leading-none",
                size === "lg" ? "text-2xl" : "text-lg",
                s === "-" ? "text-text-3" : s === "x" ? "text-warn" : "text-chord",
              )}
            >
              {s === "D" ? "↓" : s === "U" ? "↑" : s === "x" ? "×" : "·"}
            </span>
            {pm && <span className="text-[9px] leading-none text-text-3">PM</span>}
          </>
        );
        const cls = cx(
          "flex flex-col items-center justify-center gap-0.5 rounded-md border transition-colors",
          size === "lg" ? "w-11 h-14" : "w-9 h-12",
          activeSlot === i ? "border-accent bg-accent-wash" : onBeat ? "border-line" : "border-line-soft",
          onBeat && i > 0 && "ml-1.5",
        );
        return onToggle ? (
          <button key={i} type="button" data-slot={i} className={cx(cls, "hover:bg-surface-2")} onClick={() => onToggle(i)} aria-label={`Slot ${i + 1}: ${s === "D" ? "down" : s === "U" ? "up" : s === "x" ? "muted" : "rest"}${accent ? ", accented" : ""}`}>
            {cell}
          </button>
        ) : (
          <div key={i} data-slot={i} className={cls}>
            {cell}
          </div>
        );
      })}
    </div>
  );
}

export function StrumEditor({ song }: { song: Song }) {
  const meter = meterInfo(song.timeSignature);
  const defaultSpb = meter.isCompound ? 3 : 2;
  const [draft, setDraft] = useState<StrumPattern | null>(null);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);

  const slotsPerBar = (spb: number) => meter.beatsPerBar * spb;

  function startNew(preset?: (typeof PRESET_PATTERNS)[number]) {
    const spb = preset?.slotsPerBeat ?? defaultSpb;
    const slots = preset ? parsePattern(preset.slots, slotsPerBar(spb)) : null;
    setDraft(makePattern(preset?.name ?? "My pattern", slots ?? Array<StrumSlot>(slotsPerBar(spb)).fill("-"), spb));
    setText(slots ? formatPattern(slots) : "");
    setTextError(null);
  }

  async function save() {
    if (!draft) return;
    await updateSong(song.id, (s) => {
      const exists = s.strumPatterns.some((p) => p.id === draft.id);
      return { ...s, strumPatterns: exists ? s.strumPatterns.map((p) => (p.id === draft.id ? draft : p)) : [...s.strumPatterns, draft] };
    });
    setDraft(null);
  }

  const presets = PRESET_PATTERNS.filter((p) => p.beats === meter.beatsPerBar);

  return (
    <div className="flex flex-col gap-5 max-w-[860px]">
      <p className="text-text-2">
        Strumming patterns are shown in the Practice Studio and used by the rhythm drill. GuitarCoach checks the timing of your strums from the microphone; it
        does not judge whether a strum was down or up, because that can&apos;t be heard reliably.
      </p>
      {song.strumPatterns.length === 0 && !draft && <p className="text-text-3">No patterns yet.</p>}
      <ul className="flex flex-col gap-4">
        {song.strumPatterns.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-4">
            <div className="min-w-[140px]">
              <p>{p.name}</p>
              <p className="text-sm text-text-3">
                {p.slotsPerBeat === 3 ? "Triplets" : p.slotsPerBeat === 6 ? "Sixteenth triplets" : p.slotsPerBeat === 4 ? "Sixteenths" : p.slotsPerBeat === 1 ? "Quarter notes" : "Eighths"}
                {p.bpm ? `, ${p.bpm} BPM` : ""}
                {p.source === "source-site" ? ", from the source site" : ""}
              </p>
            </div>
            <PatternGrid slots={p.slots} slotsPerBeat={p.slotsPerBeat} beatsPerBar={meter.beatsPerBar} accents={p.accents} palmMutes={p.palmMutes} />
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setDraft(p); setText(formatPattern(p.slots)); }}>
                Edit
              </Button>
              <IconButton icon="trash" label={`Delete pattern ${p.name}`} size={34} onClick={() => updateSong(song.id, (s) => ({ ...s, strumPatterns: s.strumPatterns.filter((x) => x.id !== p.id) }))} />
            </div>
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="rounded-xl border border-line-soft bg-surface p-4 flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Name" htmlFor="pat-name">
              <Input id="pat-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Subdivision" htmlFor="pat-sub">
              <Select
                id="pat-sub"
                value={draft.slotsPerBeat}
                onChange={(e) => {
                  const spb = Number(e.target.value);
                  setDraft({ ...draft, slotsPerBeat: spb, slots: Array<StrumSlot>(slotsPerBar(spb)).fill("-") });
                  setText("");
                }}
              >
                <option value={1}>Beats only</option>
                <option value={2}>Eighth notes</option>
                <option value={3}>Triplets</option>
                <option value={4}>Sixteenth notes</option>
              </Select>
            </Field>
          </div>
          <PatternGrid
            slots={draft.slots}
            slotsPerBeat={draft.slotsPerBeat}
            beatsPerBar={meter.beatsPerBar}
            size="lg"
            onToggle={(i) => {
              const slots = [...draft.slots];
              slots[i] = CYCLE[(CYCLE.indexOf(slots[i]) + 1) % CYCLE.length];
              setDraft({ ...draft, slots });
              setText(formatPattern(slots));
            }}
          />
          <p className="text-sm text-text-3">Click a slot to cycle rest → down → up → muted. Or type it:</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const slots = parsePattern(text, slotsPerBar(draft.slotsPerBeat));
              if (!slots) setTextError(`Use D, U, - (rest) and x (muted), up to ${slotsPerBar(draft.slotsPerBeat)} symbols.`);
              else {
                setDraft({ ...draft, slots });
                setTextError(null);
              }
            }}
          >
            <Input aria-label="Pattern text" className="font-mono flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="D - D U - U D U" />
            <Button type="submit">Apply</Button>
          </form>
          {textError && <Notice tone="warn">{textError}</Notice>}
          <div className="flex gap-2">
            <Button variant="primary" icon="check" onClick={save}>
              Save pattern
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button icon="plus" onClick={() => startNew()}>
            New pattern
          </Button>
          {presets.map((p) => (
            <Button key={p.name} variant="ghost" onClick={() => startNew(p)}>
              {p.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
