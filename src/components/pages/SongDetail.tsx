"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button, ButtonLink, ConfirmDialog, Field, IconButton, Input, Notice, Pill, Segmented, Select, Spinner, Toggle, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SongSheet } from "@/components/SongSheet";
import { ChordShapes } from "@/components/ChordShapes";
import { DisplayControls } from "@/components/DisplayControls";
import { applyDisplay, isIdentity, prefsOf, soundingKey } from "@/lib/music/display";
import { StrumEditor } from "@/components/StrumEditor";
import { addYouTubeRecording, deleteRecording, deleteSong, getSong, listRecordings, listSessions, replaceRecordingAudio, updateSong } from "@/lib/db/db";
import { parseYouTubeId } from "@/lib/media/youtube";
import { exportSong } from "@/lib/db/backup";
import { downloadFile, formatDuration, formatTime, relativeDate, safeFileName, useLiveQuery, useSettings } from "@/lib/hooks";
import { parseSongText } from "@/lib/parse";
import { sectionsToText, songToChordPro, songToText } from "@/lib/parse/serialize";
import { carryOverDurations } from "@/lib/song/build";
import { uniqueChords, type DisplayPrefs, type Recording, type Song } from "@/lib/song/model";
import { formatTimeSignature, parseTimeSignature, SUPPORTED_TIME_SIGNATURES } from "@/lib/music/meter";
import { keyPrefersFlats, parseChord, transposeChord } from "@/lib/music/chords";
import { statusLabel } from "@/lib/song/alignment";
import { attachRecording, estimateAlignment } from "@/lib/audio/attach";
import { audioDuration } from "@/lib/audio/analyzeFile";
import { MODE_LABELS } from "@/lib/coach/types";

type Tab = "sheet" | "edit" | "audio" | "strum" | "history";

export function SongDetail() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const song = useLiveQuery(() => getSong(id), [id]);
  if (song.status === "loading") return <div className="p-8"><Spinner /></div>;
  if (song.status === "error" || !song.data) {
    return (
      <div className="p-8 max-w-[560px]">
        <Notice tone="warn" title="Song not found" action={<ButtonLink href="/songs">Open My Songs</ButtonLink>}>
          It may have been deleted, or it was saved in a different browser.
        </Notice>
      </div>
    );
  }
  return <SongView song={song.data} justSaved={params.get("saved") === "1"} initialTab={(params.get("tab") as Tab) || "sheet"} />;
}

function SongView({ song, justSaved, initialTab }: { song: Song; justSaved: boolean; initialTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settings] = useSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedVisible, setSavedVisible] = useState(justSaved);
  const recordings = useLiveQuery(() => listRecordings(song.id), [song.id]);
  // Show changes immediately; persist in the background.
  const [localPrefs, setLocalPrefs] = useState<DisplayPrefs | null>(null);
  const prefs = localPrefs ?? prefsOf(song);
  const setPrefs = (p: DisplayPrefs) => {
    setLocalPrefs(p);
    void updateSong(song.id, (s) => ({ ...s, display: p }), { userEdit: false });
  };
  const shown = useMemo(() => applyDisplay(song, prefs), [song, prefs]);
  const shownChords = uniqueChords(shown);
  const sounding = (c: string) => (shown.capo ? transposeChord(c, shown.capo, keyPrefersFlats(soundingKey(song, prefs) ?? song.key)) : c);

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1200px]">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <Link href="/songs" className="text-sm text-text-3 hover:text-text inline-flex items-center gap-1 mb-1">
            <Icon name="chevronLeft" size={15} /> My Songs
          </Link>
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{song.title}</h1>
          <p className="text-text-2">{song.artist || "Unknown artist"}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {song.key && <Pill>Key {song.key}</Pill>}
            {song.capo > 0 && <Pill>Capo {song.capo}</Pill>}
            <Pill title={song.tempo.bpm ? `Tempo source: ${song.tempo.source}` : undefined}>{song.tempo.bpm ? `${song.tempo.bpm} BPM${song.tempo.status === "estimated" ? " (estimated)" : ""}` : "Tempo unknown"}</Pill>
            <Pill>{formatTimeSignature(song.timeSignature)}</Pill>
            {song.userModified && <Pill tone="info">Edited</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <IconButton
            icon="star"
            label={song.favorite ? "Remove from favorites" : "Add to favorites"}
            active={song.favorite}
            onClick={() => updateSong(song.id, (s) => ({ ...s, favorite: !s.favorite }), { userEdit: false })}
          />
          <ButtonLink href={`/studio?song=${song.id}`} variant="primary" size="lg" icon="play">
            Practise
          </ButtonLink>
        </div>
      </header>

      {savedVisible && (
        <div className="mb-5">
          <Notice
            tone="good"
            title="Saved to My Songs"
            action={
              <>
                <ButtonLink href={`/studio?song=${song.id}`} size="sm" variant="primary" icon="play">
                  Practise now
                </ButtonLink>
                <Button size="sm" icon="upload" onClick={() => setTab("audio")}>
                  Add a recording
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSavedVisible(false)}>
                  Dismiss
                </Button>
              </>
            }
          >
            It&apos;s stored on this device and works offline.
          </Notice>
        </div>
      )}

      <div className="mb-5 overflow-x-auto">
        <Segmented
          label="Song sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "sheet", label: "Sheet" },
            { value: "edit", label: "Edit" },
            { value: "audio", label: "Recordings & timing" },
            { value: "strum", label: "Strumming" },
            { value: "history", label: "History" },
          ]}
        />
      </div>

      {tab === "sheet" && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] items-start">
          <div className="min-w-0">
            {song.parse && song.parse.warnings.length > 0 && !song.userModified && (
              <ul className="mb-4 text-sm text-text-3 list-disc pl-5">
                {song.parse.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {song.sections.length > 0 && (
              <div className="mb-5 rounded-xl border border-line-soft px-3 py-2">
                <DisplayControls song={song} prefs={prefs} onChange={setPrefs} />
              </div>
            )}
            {song.sections.length ? (
              <SongSheet sections={shown.sections} fontScale={settings.fontScale} largeChords={settings.largeChords} hideChords={prefs.hideChords} showFlags />
            ) : (
              <Notice tone="info" action={<Button size="sm" onClick={() => setTab("edit")}>Add chords</Button>}>
                This song has no chords yet.
              </Notice>
            )}
          </div>
          <aside className="flex flex-col gap-5">
            {shownChords.length > 0 && (
              <section>
                <h2 className="text-sm text-text-2 font-semibold mb-2">Chord shapes</h2>
                <ChordShapes song={shown} chords={shownChords} persistSongId={isIdentity(prefs) ? song.id : undefined} />
                {shown.capo > 0 && (
                  <p className="text-xs text-text-3 mt-2">
                    Capo on fret {shown.capo}; these shapes sound as {shownChords.slice(0, 4).map(sounding).join(", ")}…
                  </p>
                )}
              </section>
            )}
            {song.sourceMeta && <SourceInfo song={song} />}
            <section className="text-sm text-text-3 flex flex-col gap-1">
              <p>Added {relativeDate(song.createdAt)}{song.source.site ? ` from ${song.source.site}` : ""}.</p>
              {song.source.url && (
                <a href={song.source.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline break-all">
                  Original page
                </a>
              )}
              <ExportLinks song={song} />
              <button type="button" className="text-left text-bad hover:underline mt-2" onClick={() => setConfirmDelete(true)}>
                Delete song
              </button>
            </section>
          </aside>
        </div>
      )}

      {tab === "edit" && <SongEditor song={song} onDone={() => setTab("sheet")} />}
      {tab === "audio" && <RecordingsPanel song={song} recordings={recordings.status === "ready" ? recordings.data : []} a4={settings.a4} />}
      {tab === "strum" && <StrumEditor song={song} />}
      {tab === "history" && <SongHistory songId={song.id} />}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${song.title}”?`}
        body="The song and its recordings are removed from this device. Practice history is kept."
        confirmLabel="Delete song"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSong(song.id);
          router.push("/songs");
        }}
      />
    </div>
  );
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function SourceInfo({ song }: { song: Song }) {
  const m = song.sourceMeta!;
  const free = (m.versions ?? []).filter((v) => !v.paid);
  const paid = (m.versions ?? []).filter((v) => v.paid);
  return (
    <section className="text-sm flex flex-col gap-2" aria-label={`From ${m.site}`}>
      <h2 className="text-sm text-text-2 font-semibold">From {m.site}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-2">
        {m.rating !== undefined && (
          <>
            <dt className="text-text-3">Rating</dt>
            <dd className="tabular">
              {m.rating.toFixed(2)} / 5{m.votes ? ` (${compact(m.votes)} votes)` : ""}
            </dd>
          </>
        )}
        {m.difficulty && (
          <>
            <dt className="text-text-3">Difficulty</dt>
            <dd className="capitalize">{m.difficulty}</dd>
          </>
        )}
        {m.versionType && (
          <>
            <dt className="text-text-3">Version</dt>
            <dd>
              {m.versionType} {m.version ? `ver ${m.version}` : ""}
            </dd>
          </>
        )}
        {m.author && (
          <>
            <dt className="text-text-3">By</dt>
            <dd>
              {m.author}
              {m.contributors ? ` + ${m.contributors} contributors` : ""}
            </dd>
          </>
        )}
        {m.views !== undefined && (
          <>
            <dt className="text-text-3">Views</dt>
            <dd className="tabular">{compact(m.views)}</dd>
          </>
        )}
        {m.tuningName && (
          <>
            <dt className="text-text-3">Tuning</dt>
            <dd>{m.tuningName}</dd>
          </>
        )}
      </dl>
      {free.length > 0 && (
        <div>
          <p className="text-text-3 mb-1">Other versions</p>
          <ul className="flex flex-col gap-1">
            {free.slice(0, 8).map((v) => (
              <li key={v.url} className="flex items-baseline gap-2">
                <Link href={`/add?url=${encodeURIComponent(v.url)}`} className="text-accent hover:underline">
                  {v.type} ver {v.version}
                </Link>
                <span className="text-text-3 tabular">
                  {v.rating !== undefined ? `${v.rating.toFixed(1)}★` : ""}
                  {v.votes ? ` · ${compact(v.votes)}` : ""}
                  {v.difficulty ? ` · ${v.difficulty}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {paid.length > 0 && <p className="text-xs text-text-3">{paid.map((v) => v.type).join(", ")} versions are sold by {m.site} and aren&apos;t imported.</p>}
    </section>
  );
}

function ExportLinks({ song }: { song: Song }) {
  const base = safeFileName(`${song.artist} ${song.title}`);
  return (
    <div className="flex flex-col gap-1 mt-2">
      <span className="text-text-2">Export</span>
      <button type="button" className="text-left text-accent hover:underline" onClick={() => downloadFile(`${base}.cho`, songToChordPro(song), "text/plain")}>
        ChordPro (.cho)
      </button>
      <button type="button" className="text-left text-accent hover:underline" onClick={() => downloadFile(`${base}.txt`, songToText(song), "text/plain")}>
        Plain text (.txt)
      </button>
      <button
        type="button"
        className="text-left text-accent hover:underline"
        onClick={async () => downloadFile(`${base}.guitarcoach.json`, JSON.stringify(await exportSong(song.id, { includeAudio: false }), null, 1))}
      >
        GuitarCoach file (.json)
      </button>
      <button
        type="button"
        className="text-left text-accent hover:underline"
        onClick={async () => downloadFile(`${base}.with-audio.guitarcoach.json`, JSON.stringify(await exportSong(song.id, { includeAudio: true })))}
      >
        GuitarCoach file with recordings
      </button>
    </div>
  );
}

function SongEditor({ song, onDone }: { song: Song; onDone: () => void }) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [key, setKey] = useState(song.key ?? "");
  const [capo, setCapo] = useState(song.capo);
  const [bpm, setBpm] = useState<number | null>(song.tempo.bpm);
  const [ts, setTs] = useState(song.timeSignature);
  const [text, setText] = useState(() => sectionsToText(song.sections));
  const [view, setView] = useState<"text" | "preview">("text");
  const parsed = useMemo(() => parseSongText(text), [text]);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await updateSong(song.id, (s) => ({
      ...s,
      title: title.trim() || s.title,
      artist: artist.trim(),
      key: key.trim() || undefined,
      capo,
      tempo: bpm !== s.tempo.bpm ? { bpm, source: "user", status: bpm ? "verified" : "none" } : s.tempo,
      timeSignature: ts,
      sections: carryOverDurations(s.sections, parsed.sections),
      chordShapes: { ...s.chordShapes, ...parsed.chordShapes },
      parse: { confidence: parsed.confidence, warnings: parsed.warnings },
    }));
    setSaving(false);
    onDone();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
      <div className="flex flex-col gap-3">
        <Field label="Title" htmlFor="e-title">
          <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Artist" htmlFor="e-artist">
          <Input id="e-artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Key" htmlFor="e-key">
            <Input id="e-key" value={key} onChange={(e) => setKey(e.target.value)} aria-invalid={!!key && !parseChord(key)} />
          </Field>
          <Field label="Capo" htmlFor="e-capo">
            <Select id="e-capo" value={capo} onChange={(e) => setCapo(Number(e.target.value))}>
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? "None" : `Fret ${i}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tempo (BPM)" htmlFor="e-bpm">
            <Input id="e-bpm" type="number" min={30} max={300} value={bpm ?? ""} onChange={(e) => setBpm(e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Time" htmlFor="e-ts">
            <Select id="e-ts" value={formatTimeSignature(ts)} onChange={(e) => setTs(parseTimeSignature(e.target.value) ?? ts)}>
              {SUPPORTED_TIME_SIGNATURES.map((t) => (
                <option key={formatTimeSignature(t)}>{formatTimeSignature(t)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="primary" icon="check" onClick={save} disabled={saving}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-text-3">Edited songs are never overwritten when you import the same song again.</p>
      </div>
      <div className="min-w-0 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Segmented label="Editor view" value={view} onChange={setView} options={[{ value: "text", label: "Edit text", icon: "pen" }, { value: "preview", label: "Preview", icon: "eye" }]} />
          <span className="text-sm text-text-3">
            {parsed.stats.chordEvents} chords{parsed.stats.flaggedLines ? `, ${parsed.stats.flaggedLines} to check` : ""}
          </span>
        </div>
        {view === "text" ? (
          <textarea
            aria-label="Chord sheet text"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[520px] rounded-xl border border-line bg-sunk px-4 py-3 font-mono text-[14px] leading-[1.45] focus:border-accent focus:outline-none whitespace-pre"
          />
        ) : (
          <div className="rounded-xl border border-line-soft bg-sunk px-5 py-5">
            <SongSheet sections={parsed.sections} showFlags />
          </div>
        )}
      </div>
    </div>
  );
}

function RecordingsPanel({ song, recordings, a4 }: { song: Song; recordings: Recording[]; a4: number }) {
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<Recording | null>(null);
  const [keepTiming, setKeepTiming] = useState(false);
  const [toDelete, setToDelete] = useState<Recording | null>(null);
  const [ytUrl, setYtUrl] = useState("");

  async function analyse(recId: string) {
    setBusy("Finding the beat and lining up the chords…");
    try {
      const r = await estimateAlignment(recId, a4, () => {});
      setMessage(
        r.aligned
          ? { tone: "good", text: `Estimated the beat (${r.bpm ? Math.round(r.bpm) : "?"} BPM) and where the sheet starts. Check it with Align timing.` }
          : { tone: "warn", text: r.bpm ? "Estimated the beat, but couldn't tell where the sheet starts. Use Align timing to set it." : "No steady beat was found. Use Align timing to tap along." },
      );
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Analysis failed." });
    } finally {
      setBusy(null);
    }
  }

  async function add(file: File) {
    setMessage(null);
    setBusy("Saving recording…");
    try {
      const rec = await attachRecording(song, file);
      await analyse(rec.id);
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "The recording couldn't be added." });
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-[860px]">
      <p className="text-text-2">
        Add your own recordings of this song to play along with. Each recording keeps its own timing, so the same chords can follow several versions.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icon="upload" variant="primary" onClick={() => input.current?.click()} disabled={!!busy}>
          Add a recording
        </Button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          className="sr-only"
          aria-label="Choose a recording to add"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void add(f);
            e.target.value = "";
          }}
        />
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const id = parseYouTubeId(ytUrl);
          if (!id) {
            setMessage({ tone: "bad", text: "That doesn't look like a YouTube video link." });
            return;
          }
          await addYouTubeRecording({ songId: song.id, youtubeId: id, name: `YouTube video ${id}`, bpm: song.tempo.bpm ?? 90 });
          setYtUrl("");
          setMessage({
            tone: "good",
            text: "Video added. Its audio can't be analysed, so open Align timing and tap along (or nudge the start) to sync the chords, then practise.",
          });
        }}
      >
        <Field label="Or play along with a YouTube video" htmlFor="yt-url">
          <Input id="yt-url" className="w-[340px] max-w-full" placeholder="https://www.youtube.com/watch?v=…" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!ytUrl.trim()}>
          Add video
        </Button>
      </form>
      <p className="text-sm text-text-3 -mt-2">
        The video plays in YouTube&apos;s own player inside GuitarCoach (needs an internet connection). Nothing is downloaded.
      </p>
      {busy && <Spinner label={busy} />}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {recordings.length === 0 ? (
        <p className="text-text-3">No recordings yet. Without one, practice runs on GuitarCoach&apos;s own metronome, which keeps exact time.</p>
      ) : (
        <ul className="divide-y divide-line-soft border-y border-line-soft">
          {recordings.map((r) => {
            const active = song.activeRecordingId === r.id;
            const tone = r.alignment.status === "verified" ? "good" : r.alignment.status === "calibrated" ? "info" : r.alignment.status === "estimated" ? "warn" : "neutral";
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{r.name}</p>
                  <p className="text-sm text-text-3">
                    {r.kind === "youtube" ? "YouTube video" : formatTime(r.durationSec)}, {Math.round(r.alignment.bpm)} BPM, added {relativeDate(r.createdAt)}
                  </p>
                </div>
                <Pill tone={tone}>{statusLabel(r.alignment.status)}</Pill>
                {active ? (
                  <Pill tone="good">Used for practice</Pill>
                ) : (
                  <Button size="sm" onClick={() => updateSong(song.id, (s) => ({ ...s, activeRecordingId: r.id }), { userEdit: false })}>
                    Use for practice
                  </Button>
                )}
                <ButtonLink href={`/align?song=${song.id}&rec=${r.id}`} size="sm" icon="clock">
                  Align timing
                </ButtonLink>
                {r.kind !== "youtube" && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => analyse(r.id)} disabled={!!busy}>
                      Re-analyse
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplaceTarget(r)}>
                      Replace audio
                    </Button>
                  </>
                )}
                <IconButton icon="trash" label={`Delete recording ${r.name}`} size={34} onClick={() => setToDelete(r)} />
              </li>
            );
          })}
        </ul>
      )}

      {replaceTarget && (
        <Notice
          tone="info"
          title={`Replace the audio of “${replaceTarget.name}”`}
          action={
            <>
              <Button size="sm" variant="primary" onClick={() => replaceInput.current?.click()}>
                Choose new audio
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReplaceTarget(null)}>
                Cancel
              </Button>
            </>
          }
        >
          <div className="mt-2">
            <Toggle checked={keepTiming} onChange={setKeepTiming} label="Keep the current timing" description="Only if the new file is the same performance (for example a better-quality copy)." />
          </div>
          <input
            ref={replaceInput}
            type="file"
            accept="audio/*"
            className="sr-only"
            aria-label="Choose replacement audio"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f || !replaceTarget) return;
              const d = await audioDuration(f).catch(() => 0);
              await replaceRecordingAudio(replaceTarget.id, f, d, keepTiming);
              const id = replaceTarget.id;
              setReplaceTarget(null);
              if (!keepTiming) await analyse(id);
            }}
          />
        </Notice>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this recording?"
        body={`“${toDelete?.name}” and its timing are removed from this device.`}
        confirmLabel="Delete recording"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteRecording(toDelete.id)}
      />
      <p className="text-sm text-text-3">
        Use recordings you&apos;re allowed to use, such as your own or purchased files. GuitarCoach never downloads audio from other websites.
      </p>
      {recordings.some((r) => r.alignment.status === "estimated") && (
        <p className="text-sm text-text-3">
          Estimated timing is good enough for guided scrolling. For millisecond timing feedback, tap along or adjust the chord changes in Align timing.
        </p>
      )}
    </div>
  );
}

function SongHistory({ songId }: { songId: string }) {
  const sessions = useLiveQuery(() => listSessions(songId), [songId]);
  if (sessions.status !== "ready") return <Spinner />;
  if (sessions.data.length === 0) return <p className="text-text-3">No practice sessions for this song yet.</p>;
  return (
    <ul className="divide-y divide-line-soft border-y border-line-soft max-w-[860px]">
      {sessions.data.map((s) => (
        <li key={s.id}>
          <Link href={`/report?id=${s.id}`} className="flex flex-wrap items-center gap-4 py-3 px-1 hover:bg-surface">
            <span className="w-32 text-sm text-text-3">{new Date(s.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            <span className="flex-1">{MODE_LABELS[s.mode]}</span>
            <span className="text-sm text-text-2 tabular">{formatDuration(s.activeSec)}</span>
            <span className={cx("text-sm tabular w-36 text-right", s.summary.chordAccuracy === null ? "text-text-3" : "text-text")}>
              {s.summary.chordAccuracy === null ? "Chords not measured" : `${Math.round(s.summary.chordAccuracy * 100)}% chords correct`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
