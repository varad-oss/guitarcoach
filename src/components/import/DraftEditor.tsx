"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SongSheet } from "@/components/SongSheet";
import { PatternGrid } from "@/components/StrumEditor";
import { Button, Dialog, Field, Input, Notice, Pill, Segmented, Select, cx } from "@/components/ui";
import { draftToSong, parseDraft, type Draft } from "@/lib/import/draft";
import { listSongs, saveSong } from "@/lib/db/db";
import { findDuplicates } from "@/lib/song/build";
import { useLiveQuery } from "@/lib/hooks";
import { sectionsToText } from "@/lib/parse/serialize";
import { formatTimeSignature, parseTimeSignature, SUPPORTED_TIME_SIGNATURES } from "@/lib/music/meter";
import { normaliseChord, parseChord } from "@/lib/music/chords";
import { nowIso, type Song, type SongSection } from "@/lib/song/model";

export function DraftEditor({
  draft,
  onChange,
  onCancel,
  onImportVersion,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel?: () => void;
  onImportVersion?: (url: string) => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<"preview" | "text">("preview");
  const [editing, setEditing] = useState<{ section: number; line: number; chord: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseDraft(draft), [draft]);
  const library = useLiveQuery(listSongs, []);
  // Metadata found in the text is absorbed when the draft is created, so fields stay freely editable here.
  const effective = draft;

  const candidate = useMemo(() => draftToSong(effective, parsed), [effective, parsed]);
  const duplicates = useMemo(
    () => (library.status === "ready" ? findDuplicates(candidate, library.data) : []),
    [library, candidate],
  );

  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const chordCount = parsed.stats.chordEvents;
  const sectionCount = parsed.sections.filter((s) => s.lines.some((l) => l.chords.length > 0)).length;
  const confidenceTone = parsed.confidence >= 0.85 ? "good" : parsed.confidence >= 0.6 ? "warn" : "bad";

  async function save(mode: "new" | "replace", then: "song" | "practice", existing?: Song) {
    if (!effective.title.trim()) {
      setError("Give the song a title before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let song = candidate;
      if (mode === "replace" && existing) {
        song = {
          ...candidate,
          id: existing.id,
          createdAt: existing.createdAt,
          favorite: existing.favorite,
          lastPlayedAt: existing.lastPlayedAt,
          lastPosition: existing.lastPosition,
          activeRecordingId: existing.activeRecordingId,
          // Fresh patterns from the source replace old ones; patterns you made yourself are kept.
          strumPatterns: [...candidate.strumPatterns, ...existing.strumPatterns.filter((p) => p.source !== "source-site")],
          display: existing.display,
          updatedAt: nowIso(),
          userModified: false,
        };
      }
      const saved = await saveSong(song);
      router.push(then === "practice" ? `/studio?song=${saved.id}` : `/song?id=${saved.id}&saved=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The song could not be saved.");
      setSaving(false);
    }
  }

  function applyChordEdit(newName: string | null) {
    if (!editing) return;
    const sections: SongSection[] = structuredClone(parsed.sections);
    const line = sections[editing.section].lines[editing.line];
    if (newName === null) line.chords.splice(editing.chord, 1);
    else line.chords[editing.chord] = { ...line.chords[editing.chord], chord: normaliseChord(newName) };
    if (line.flag) line.flag = undefined;
    const header = draft.text.split("\n").filter((l) => /^\s*(title|artist|key|capo|tempo|bpm|time)\s*:/i.test(l));
    onChange({ ...draft, text: [...header, "", sectionsToText(sections)].join("\n").trim() + "\n" });
    setEditing(null);
  }

  const editingChord = editing ? parsed.sections[editing.section]?.lines[editing.line]?.chords[editing.chord] : undefined;
  const isUg = draft.source.adapterId === "ultimate-guitar";
  const sameSource = duplicates.find((d) => d.reason === "same-source");

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] items-start">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto scroll-thin lg:pr-2" aria-label="Song details">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Title" htmlFor="d-title">
              <Input id="d-title" value={effective.title} onChange={(e) => set({ title: e.target.value })} placeholder="Song title" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Artist" htmlFor="d-artist">
              <Input id="d-artist" value={effective.artist} onChange={(e) => set({ artist: e.target.value })} placeholder="Artist" />
            </Field>
          </div>
          <Field label="Key" htmlFor="d-key">
            <Input
              id="d-key"
              value={effective.key}
              onChange={(e) => set({ key: e.target.value })}
              placeholder="e.g. G"
              aria-invalid={!!effective.key && !parseChord(effective.key)}
            />
          </Field>
          <Field label="Capo" htmlFor="d-capo">
            <Select id="d-capo" value={effective.capo} onChange={(e) => set({ capo: Number(e.target.value) })}>
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? "None" : `Fret ${i}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tempo (BPM)" htmlFor="d-bpm" hint={draft.bpmFromSource ? "From the source site" : !effective.bpm ? "Unknown; you can set it later" : undefined}>
            <Input
              id="d-bpm"
              type="number"
              min={30}
              max={300}
              inputMode="numeric"
              value={effective.bpm ?? ""}
              onChange={(e) => set({ bpm: e.target.value ? Number(e.target.value) : null, bpmFromSource: false })}
              placeholder="—"
            />
          </Field>
          <Field label="Time" htmlFor="d-time" hint={!draft.timeSignature && !parsed.timeSignature ? "Not in the sheet; 4/4 assumed" : undefined}>
            <Select
              id="d-time"
              value={formatTimeSignature(effective.timeSignature ?? { numerator: 4, denominator: 4 })}
              onChange={(e) => set({ timeSignature: parseTimeSignature(e.target.value) })}
            >
              {SUPPORTED_TIME_SIGNATURES.map((t) => (
                <option key={formatTimeSignature(t)} value={formatTimeSignature(t)}>
                  {formatTimeSignature(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5" aria-label="Import summary">
          <Pill>{sectionCount} sections</Pill>
          <Pill>{chordCount} chords</Pill>
          <Pill tone={confidenceTone} title="How much of the sheet was read without guesswork">
            {parsed.confidence >= 0.85 ? "Read cleanly" : parsed.confidence >= 0.6 ? "Mostly read" : "Needs review"}
          </Pill>
          {parsed.stats.flaggedLines > 0 && <Pill tone="warn">{parsed.stats.flaggedLines} to check</Pill>}
        </div>

        {duplicates.length > 0 && !saving && (
          <Notice
            tone="warn"
            title={sameSource ? "You've imported this link before" : "A song with this title is already in your library"}
            action={
              <>
                <Button size="sm" onClick={() => router.push(`/song?id=${duplicates[0].song.id}`)}>
                  Open existing
                </Button>
                {!duplicates[0].song.userModified ? (
                  <Button size="sm" onClick={() => save("replace", "song", duplicates[0].song)} disabled={saving}>
                    Update existing
                  </Button>
                ) : null}
              </>
            }
          >
            {duplicates[0].song.userModified
              ? "You've edited that copy, so it won't be replaced. Saving below adds this as a separate song."
              : "Update it with this import, or save this as a separate song."}
          </Notice>
        )}

        {error && <Notice tone="bad">{error}</Notice>}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" icon="check" onClick={() => save("new", "song")} disabled={saving || chordCount + sectionCount === 0 && !draft.text.trim()}>
            {duplicates.length ? "Save as new song" : "Save to My Songs"}
          </Button>
          <Button size="lg" icon="play" onClick={() => save("new", "practice")} disabled={saving || chordCount === 0}>
            Save and practice
          </Button>
          {onCancel && (
            <Button variant="ghost" size="lg" onClick={onCancel}>
              Start over
            </Button>
          )}
        </div>
        {(parsed.warnings.length > 0 || draft.hints.length > 0 || draft.lowConfidenceReason) && (
          <ul className="text-sm text-text-2 flex flex-col gap-1.5 list-disc pl-5">
            {draft.lowConfidenceReason && <li className="text-warn">{draft.lowConfidenceReason}</li>}
            {parsed.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {draft.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}

        {(draft.strumPatterns.length > 0 || Object.keys(draft.shapes).length > 0) && (
          <section className="flex flex-col gap-3" aria-label="Also imported">
            <h2 className="text-sm text-text-2 font-semibold">Also imported</h2>
            {Object.keys(draft.shapes).length > 0 && (
              <p className="text-sm text-text-2">
                Chord diagrams for {Object.keys(draft.shapes).length} chords
                {Object.values(draft.shapes).some((s) => s.alternates?.length) ? `, with up to ${1 + Math.max(...Object.values(draft.shapes).map((s) => s.alternates?.length ?? 0))} voicings each` : ""}.
              </p>
            )}
            {draft.strumPatterns.map((p) => (
              <div key={p.id} className="flex flex-col gap-1">
                <span className="text-sm text-text-2">
                  {p.name}
                  {p.bpm ? `, ${p.bpm} BPM` : ""}
                </span>
                <PatternGrid slots={p.slots} slotsPerBeat={p.slotsPerBeat} beatsPerBar={4} accents={p.accents} palmMutes={p.palmMutes} />
              </div>
            ))}
          </section>
        )}

        {isUg && draft.sourceMeta?.versions && draft.sourceMeta.versions.some((v) => !v.paid) && (
          <section className="flex flex-col gap-1.5" aria-label="Other versions">
            <h2 className="text-sm text-text-2 font-semibold">Other versions on {draft.sourceMeta.site}</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {draft.sourceMeta.versions
                .filter((v) => !v.paid)
                .slice(0, 8)
                .map((v) => (
                  <li key={v.url} className="flex items-baseline gap-2">
                    <button type="button" className="text-accent hover:underline" onClick={() => onImportVersion?.(v.url)} disabled={!onImportVersion}>
                      {v.type} ver {v.version}
                    </button>
                    <span className="text-text-3 tabular">
                      {v.rating !== undefined ? `${v.rating.toFixed(1)}★` : ""}
                      {v.votes ? ` · ${v.votes} votes` : ""}
                      {v.difficulty ? ` · ${v.difficulty}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
            {draft.sourceMeta.rating !== undefined && (
              <p className="text-xs text-text-3">
                This version: {draft.sourceMeta.rating.toFixed(2)}★ from {draft.sourceMeta.votes ?? 0} votes{draft.sourceMeta.difficulty ? `, ${draft.sourceMeta.difficulty}` : ""}.
              </p>
            )}
          </section>
        )}

      </aside>

      <section aria-label="Sheet preview" className="min-w-0 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "preview", label: "Preview", icon: "eye" },
              { value: "text", label: "Edit text", icon: "pen" },
            ]}
          />
          <p className="text-sm text-text-3">{view === "preview" ? "Click a chord to rename or remove it." : "Put chords on their own line above the lyrics."}</p>
        </div>
        {view === "preview" ? (
          <div className="rounded-xl border border-line-soft bg-sunk px-5 py-5 min-h-[320px]" data-testid="draft-preview">
            {parsed.sections.length === 0 ? (
              <p className="text-text-3">Nothing to preview yet. Switch to Edit text and paste or type the chord sheet.</p>
            ) : (
              <SongSheet sections={parsed.sections} showFlags onChordClick={setEditing} />
            )}
          </div>
        ) : (
          <textarea
            aria-label="Chord sheet text"
            value={draft.text}
            onChange={(e) => set({ text: e.target.value })}
            spellCheck={false}
            className={cx(
              "min-h-[480px] w-full rounded-xl border border-line bg-sunk px-4 py-3 font-mono text-[14px] leading-[1.45] text-text focus:border-accent focus:outline-none resize-y whitespace-pre overflow-x-auto",
            )}
          />
        )}
      </section>

      <ChordEditDialog
        open={!!editing}
        chord={editingChord?.chord ?? ""}
        onClose={() => setEditing(null)}
        onApply={applyChordEdit}
      />
    </div>
  );
}

function ChordEditDialog({ open, chord, onClose, onApply }: { open: boolean; chord: string; onClose: () => void; onApply: (v: string | null) => void }) {
  const [value, setValue] = useState(chord);
  const [lastChord, setLastChord] = useState(chord);
  if (chord !== lastChord) {
    setLastChord(chord);
    setValue(chord);
  }
  const valid = !!parseChord(value);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Edit chord ${chord}`}
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={() => onApply(null)}>
            Remove
          </Button>
          <Button variant="primary" onClick={() => valid && onApply(value)} disabled={!valid}>
            Apply
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onApply(value);
        }}
      >
        <Field label="Chord" htmlFor="chord-edit" hint={valid ? `Reads as ${normaliseChord(value)}` : "Not a chord name GuitarCoach recognises"}>
          <Input id="chord-edit" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!valid} />
        </Field>
      </form>
    </Dialog>
  );
}
