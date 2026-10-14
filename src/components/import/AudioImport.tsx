"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Meter, Notice, Pill, Select } from "@/components/ui";
import { SongSheet } from "@/components/SongSheet";
import { analyseInWorker, decodeForAnalysis } from "@/lib/audio/analyzeFile";
import type { FileAnalysis } from "@/lib/dsp/fileAnalysis";
import { alignmentFromAnalysis, analysisSummary, sectionsFromAnalysis } from "@/lib/song/fromAnalysis";
import { addRecording, saveSong, updateRecording } from "@/lib/db/db";
import { createEmptySong, nowIso } from "@/lib/song/model";
import { formatTimeSignature, meterInfo, parseTimeSignature, SUPPORTED_TIME_SIGNATURES, type TimeSignature } from "@/lib/music/meter";
import type { PartialInfo } from "@/lib/import/types";
import { formatTime, useSettings } from "@/lib/hooks";

function titleFromFile(f: File): string {
  return f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

export function AudioImport({ initialFile, carry }: { initialFile: File | null; carry: PartialInfo | null }) {
  const router = useRouter();
  const [settings] = useSettings();
  const [file, setFile] = useState<File | null>(initialFile);
  const [title, setTitle] = useState(carry?.title ?? (initialFile ? titleFromFile(initialFile) : ""));
  const [artist, setArtist] = useState(carry?.artist ?? "");
  const [ts, setTs] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Results are keyed by file + meter, so stale results are simply ignored.
  const jobKey = file ? `${file.name}:${file.size}:${file.lastModified}:${formatTimeSignature(ts)}` : null;
  const [result, setResult] = useState<{ key: string; analysis?: FileAnalysis; duration: number; error?: string } | null>(null);
  const [progressState, setProgressState] = useState<{ key: string; p: number } | null>(null);

  useEffect(() => {
    if (!file || !jobKey) return;
    let cancelled = false;
    (async () => {
      try {
        const audio = await decodeForAnalysis(file);
        if (cancelled) return;
        const a = await analyseInWorker(audio, { beatsPerBar: meterInfo(ts).beatsPerBar, targetBpm: null, a4: settings.a4 }, (p) => {
          if (!cancelled) setProgressState({ key: jobKey, p });
        });
        if (!cancelled) setResult({ key: jobKey, analysis: a, duration: audio.duration });
      } catch (e) {
        if (!cancelled) setResult({ key: jobKey, duration: 0, error: e instanceof Error ? e.message : "The recording couldn't be analysed." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey]);

  const current = result && result.key === jobKey ? result : null;
  const analysis = current?.analysis ?? null;
  const duration = current?.duration ?? 0;
  const error = saveError ?? current?.error ?? null;
  const progress = jobKey && !current ? (progressState?.key === jobKey ? progressState.p : 0) : null;

  const beatsPerBar = meterInfo(ts).beatsPerBar;
  const sections = analysis ? sectionsFromAnalysis(analysis, beatsPerBar) : [];
  const chordCount = sections.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.chords.length, 0), 0);
  const meanConfidence = analysis && analysis.segments.length ? analysis.segments.reduce((a, s) => a + s.confidence, 0) / analysis.segments.length : 0;

  async function save() {
    if (!file || !analysis) return;
    setSaving(true);
    try {
      const song = await saveSong(
        createEmptySong({
          title: title.trim() || "Untitled recording",
          artist: artist.trim(),
          tempo: { bpm: analysis.bpm, source: "audio-analysis", status: analysis.bpm ? "estimated" : "none" },
          timeSignature: ts,
          sections,
          source: { kind: "audio", fileName: file.name, url: carry?.url, site: carry?.site, importedAt: nowIso() },
          parse: {
            confidence: Math.round(meanConfidence * 100) / 100,
            warnings: ["Chords, tempo and sections were estimated from the recording. Check them before relying on them."],
          },
          structureTiming: "estimated",
        }),
      );
      const rec = await addRecording({ songId: song.id, blob: file, name: file.name, durationSec: duration, bpm: analysis.bpm ?? 90 });
      await updateRecording(rec.id, (r) => ({ ...r, analysis: analysisSummary(analysis), alignment: alignmentFromAnalysis(analysis, 90) }));
      router.push(`/song?id=${song.id}&saved=1`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The song couldn't be saved.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-text-2 max-w-[68ch]">
        Upload a recording you&apos;re allowed to use. GuitarCoach estimates its tempo, beat and likely chords on this device. Automatic chord transcription
        is hard, so everything it finds is marked as estimated and you can correct it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Button icon="upload" onClick={() => input.current?.click()}>
          {file ? "Choose another recording" : "Choose a recording"}
        </Button>
        <input
          ref={input}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.opus"
          className="sr-only"
          aria-label="Choose an audio file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFile(f);
              if (!title || title === (file ? titleFromFile(file) : "")) setTitle(titleFromFile(f));
            }
            e.target.value = "";
          }}
        />
        <Field label="Time signature" htmlFor="ai-ts">
          <Select id="ai-ts" value={formatTimeSignature(ts)} onChange={(e) => setTs(parseTimeSignature(e.target.value) ?? ts)}>
            {SUPPORTED_TIME_SIGNATURES.map((t) => (
              <option key={formatTimeSignature(t)}>{formatTimeSignature(t)}</option>
            ))}
          </Select>
        </Field>
        {file && <span className="text-sm text-text-3">{file.name}</span>}
      </div>

      {progress !== null && (
        <div className="max-w-[420px] flex flex-col gap-2" role="status">
          <span className="text-text-2 text-sm">Listening to the recording… {Math.round(progress * 100)}%</span>
          <Meter value={progress} label="Analysis progress" />
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}

      {analysis && (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
          <div className="flex flex-col gap-3">
            <Field label="Title" htmlFor="ai-title">
              <Input id="ai-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Artist" htmlFor="ai-artist">
              <Input id="ai-artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </Field>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-text-3">Length</dt>
              <dd className="tabular">{formatTime(duration)}</dd>
              <dt className="text-text-3">Estimated tempo</dt>
              <dd className="tabular">{analysis.bpm ? `${Math.round(analysis.bpm)} BPM` : "No steady beat found"}</dd>
              <dt className="text-text-3">Tempo confidence</dt>
              <dd>{analysis.bpm ? <Pill tone={analysis.bpmConfidence > 0.5 ? "good" : analysis.bpmConfidence > 0.2 ? "warn" : "bad"}>{analysis.bpmConfidence > 0.5 ? "Clear beat" : analysis.bpmConfidence > 0.2 ? "Some doubt" : "Weak"}</Pill> : "—"}</dd>
              <dt className="text-text-3">Estimated chords</dt>
              <dd className="tabular">{chordCount}</dd>
              <dt className="text-text-3">Chord confidence</dt>
              <dd>
                <Pill tone={meanConfidence > 0.5 ? "good" : meanConfidence > 0.25 ? "warn" : "bad"}>{meanConfidence > 0.5 ? "Fairly clear" : meanConfidence > 0.25 ? "Mixed" : "Low"}</Pill>
              </dd>
            </dl>
            {!analysis.bpm && <Notice tone="warn">No steady beat was found. You can still play the recording and set the beat by tapping along later.</Notice>}
            <Button variant="primary" size="lg" icon="check" onClick={save} disabled={saving}>
              Save song and recording
            </Button>
          </div>
          <div className="rounded-xl border border-line-soft bg-sunk px-5 py-5 min-h-[240px]">
            <p className="text-sm text-warn mb-3">Estimated from the audio. You can edit chords and timing after saving.</p>
            {sections.length ? <SongSheet sections={sections} /> : <p className="text-text-3">No chords could be estimated. The recording can still be used for playback and rhythm practice.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
