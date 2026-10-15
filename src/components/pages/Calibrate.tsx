"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, IconButton, Input, Notice, PageHeader, Pill, Spinner, Toggle, cx } from "@/components/ui";
import { ChordDiagram } from "@/components/ChordDiagram";
import { MicButton, MicProblem } from "@/components/studio/parts";
import { useMic } from "@/lib/studio/useMic";
import { getReady } from "@/lib/studio/getReady";
import { getCalibration, listSongs, saveCalibration } from "@/lib/db/db";
import { useLiveQuery, useSettings, relativeDate } from "@/lib/hooks";
import { checkTake, evaluateCalibration, type CalibrationFrame } from "@/lib/dsp/calibration";
import { normaliseChord, parseChord } from "@/lib/music/chords";
import { shapeForChord } from "@/lib/music/shapes";
import { newId, nowIso, uniqueChords } from "@/lib/song/model";

const DEFAULT_CHORDS = ["G", "C", "D", "Em", "Am", "E", "A", "Dm", "F"];
const TAKES_WANTED = 2;
const MAX_SECONDS = 10;

type Recording =
  | { phase: "listening"; chord: string; frames: CalibrationFrame[]; onsets: number[]; startedAt: number }
  | { phase: "doubt"; chord: string; frames: CalibrationFrame[]; heard: string };

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function Calibrate() {
  const [settings, updateSettings] = useSettings();
  const cal = useLiveQuery(getCalibration, []);
  const songs = useLiveQuery(listSongs, []);
  const mic = useMic({ mode: "chords", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs });
  const [extra, setExtra] = useState<string[]>([]);
  const [newChord, setNewChord] = useState("");
  const [rec, setRec] = useState<Recording | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const recRef = useRef<Recording | null>(null);
  /** Single place that changes the take in progress, keeping the ref (read by audio callbacks) and state in step. */
  const setTake = (next: Recording | null) => {
    recRef.current = next;
    setRec(next);
  };
  const [tick, setTick] = useState(0);

  const takes = useMemo(() => (cal.status === "ready" ? cal.data.takes : []), [cal]);
  const libraryChords = useMemo(() => {
    if (songs.status !== "ready") return [];
    const all = new Set<string>();
    for (const s of songs.data) for (const c of uniqueChords(s)) all.add(normaliseChord(c));
    return [...all];
  }, [songs]);
  const chords = useMemo(() => {
    const list = [...DEFAULT_CHORDS, ...libraryChords, ...extra, ...takes.map((t) => t.chord)].map(normaliseChord);
    return [...new Set(list)].filter((c) => parseChord(c));
  }, [libraryChords, extra, takes]);
  const countFor = (c: string) => takes.filter((t) => normaliseChord(t.chord) === c).length;
  const report = useMemo(() => (new Set(takes.map((t) => normaliseChord(t.chord))).size >= 2 ? evaluateCalibration(takes) : []), [takes]);

  // Collect strummed, pitched frames from just after each strum.
  useEffect(
    () =>
      mic.onOnset((t) => {
        const r = recRef.current;
        if (r?.phase !== "listening") return;
        setTake({ ...r, onsets: [...r.onsets, t] });
      }),
    [mic],
  );
  useEffect(
    () =>
      mic.onFrame((f) => {
        const r = recRef.current;
        if (r?.phase !== "listening") return;
        const afterStrum = r.onsets.some((o) => f.soundTime >= o + 0.12 && f.soundTime <= o + 1.4);
        if (afterStrum && f.tonal && f.rmsDb > -50) {
          const frame = { chroma: f.chroma.map((x) => Math.round(x * 1000) / 1000), bassPc: f.bassPc };
          setTake({ ...r, frames: [...r.frames, frame] });
        }
      }),
    [mic],
  );

  async function keep(chord: string, frames: CalibrationFrame[]) {
    setTake(null);
    await saveCalibration((c) => ({ ...c, takes: [...c.takes, { id: newId("take"), chord, frames, createdAt: nowIso() }] }));
    setMessage({ tone: "good", text: `Saved a take of ${chord}.` });
  }

  // Finish a take once there is enough evidence, or give up after a while.
  useEffect(() => {
    if (rec?.phase !== "listening") return;
    const enough = rec.onsets.length >= 3 && rec.frames.length >= 15;
    const timedOut = performance.now() - rec.startedAt > MAX_SECONDS * 1000;
    if (enough) {
      // Close the take right away so a late frame can't finish (and save) it twice.
      if (recRef.current !== rec) return;
      recRef.current = null;
      const check = checkTake(rec.chord, rec.frames);
      queueMicrotask(() => {
        if (check.ok) void keep(rec.chord, rec.frames);
        else setTake({ phase: "doubt", chord: rec.chord, frames: rec.frames, heard: check.heard });
      });
    } else if (timedOut) {
      if (recRef.current !== rec) return;
      recRef.current = null;
      queueMicrotask(() => {
        setTake(null);
        setMessage({
          tone: "warn",
          text:
            rec.onsets.length < 3
              ? "Not enough strums were heard. Strum the chord 3–4 times, a second apart, close to the microphone."
              : "The chord didn't come through clearly. Let all the strings ring, and reduce background noise.",
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, tick]);

  useEffect(() => {
    if (rec?.phase !== "listening") return;
    // Re-check the time-out even when no audio arrives.
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [rec?.phase]);

  async function start(chord: string) {
    setMessage(null);
    if (mic.status !== "on") await mic.start();
    if (!(await getReady(`Get ready to play ${chord}`))) return;
    setTake({ phase: "listening", chord, frames: [], onsets: [], startedAt: performance.now() });
  }

  if (cal.status !== "ready") return <div className="p-8"><Spinner /></div>;
  const recorded = chords.filter((c) => countFor(c) > 0).length;
  const avg = (f: (r: (typeof report)[number]) => number) => (report.length ? report.reduce((a, r) => a + f(r), 0) / report.length : 0);
  const withPersonal = report.filter((r) => r.personal);

  return (
    <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[1200px] flex flex-col gap-6">
      <PageHeader
        title="Chord calibration"
        description="Play each chord a few times so GuitarCoach learns how your guitar, strings, microphone and room sound. The takes are saved on this device and also become a test set showing how well chords are recognised for you."
        actions={<MicButton mic={mic} />}
      />
      <MicProblem mic={mic} />
      <Notice tone="info">
        Play without a capo, in the shapes you normally use. For each chord, record {TAKES_WANTED} takes: strum 3–4 times about a second apart and let every string ring.
      </Notice>

      {rec && (
        <section className="rounded-2xl border border-accent/40 bg-accent-wash p-5 flex flex-wrap items-center gap-6" aria-live="polite">
          <span className="chord-face text-[72px] leading-none text-chord">{rec.chord}</span>
          {rec.phase === "listening" ? (
            <div className="flex flex-col gap-1">
              <p className="text-lg">Strum {rec.chord} now, 3–4 times…</p>
              <p className="text-sm text-text-2" data-testid="calibration-progress">
                {rec.onsets.length} strum{rec.onsets.length === 1 ? "" : "s"} heard, {rec.frames.length} clear moments
              </p>
              <Button size="sm" variant="ghost" onClick={() => setTake(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-lg text-warn">That sounded more like {rec.heard} than {rec.chord}.</p>
              <p className="text-sm text-text-2">If you played {rec.chord}, check each finger and try again. Keep it only if you&apos;re sure, because it teaches GuitarCoach what {rec.chord} sounds like.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => start(rec.chord)}>
                  Try again
                </Button>
                <Button size="sm" onClick={() => keep(rec.chord, rec.frames)}>
                  Keep it anyway
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTake(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold">
            Chords <span className="text-text-3 font-normal text-sm">{recorded} of {chords.length} recorded</span>
          </h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (parseChord(newChord)) {
                setExtra((x) => [...x, normaliseChord(newChord)]);
                setNewChord("");
              }
            }}
          >
            <Input aria-label="Add a chord" placeholder="Add a chord, e.g. Cadd9" value={newChord} onChange={(e) => setNewChord(e.target.value)} className="w-48" />
            <Button type="submit" disabled={!parseChord(newChord)}>
              Add
            </Button>
          </form>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {chords.map((c) => {
            const n = countFor(c);
            const frets = shapeForChord(c);
            return (
              <li key={c} className={cx("flex items-center gap-3 rounded-xl border p-3", n >= TAKES_WANTED ? "border-accent/30" : "border-line-soft")} data-testid={`cal-${c}`}>
                {frets ? <ChordDiagram name={c} frets={frets} size={56} caption={false} /> : <span className="w-14" />}
                <div className="flex-1 min-w-0">
                  <p className="chord-face text-2xl text-chord leading-none">{c}</p>
                  <p className="text-sm text-text-3 mt-1">{n === 0 ? "Not recorded" : `${n} take${n === 1 ? "" : "s"}`}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant={n < TAKES_WANTED ? "primary" : "secondary"} onClick={() => start(c)} disabled={!!rec}>
                    {n === 0 ? "Record" : "Add take"}
                  </Button>
                  {n > 0 && (
                    <IconButton
                      icon="trash"
                      label={`Delete takes of ${c}`}
                      size={32}
                      onClick={() => saveCalibration((cd) => ({ ...cd, takes: cd.takes.filter((t) => normaliseChord(t.chord) !== c) }))}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How well your chords are recognised</h2>
        {report.length === 0 ? (
          <p className="text-text-3">Record at least two different chords to see this.</p>
        ) : (
          <>
            <p className="text-text-2">
              Each take is checked against templates learned from your <em>other</em> takes, so this isn&apos;t testing on the same recording. Built-in
              templates: {pct(avg((r) => r.generic.match))} judged correct, {pct(avg((r) => r.generic.mismatch))} wrongly called a different chord.
              {withPersonal.length > 0 &&
                ` With your calibration: ${pct(withPersonal.reduce((a, r) => a + r.personal!.match, 0) / withPersonal.length)} correct, ${pct(withPersonal.reduce((a, r) => a + r.personal!.mismatch, 0) / withPersonal.length)} wrongly called a different chord.`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]" data-testid="calibration-report">
                <thead className="text-sm text-text-3 text-left">
                  <tr className="border-b border-line-soft">
                    <th className="py-2 font-normal">Chord</th>
                    <th className="py-2 font-normal">Takes</th>
                    <th className="py-2 font-normal">Built-in: correct / wrongly flagged</th>
                    <th className="py-2 font-normal">Calibrated: correct / wrongly flagged</th>
                    <th className="py-2 font-normal">Mistaken for</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.chord} className="border-b border-line-soft">
                      <td className="py-2 chord-face text-lg text-chord">{r.chord}</td>
                      <td className="py-2 tabular">{r.takes}</td>
                      <td className="py-2 tabular">
                        {pct(r.generic.match)} / <span className={r.generic.mismatch > 0.1 ? "text-bad" : undefined}>{pct(r.generic.mismatch)}</span>
                      </td>
                      <td className="py-2 tabular">
                        {r.personal ? (
                          <>
                            {pct(r.personal.match)} / <span className={r.personal.mismatch > 0.1 ? "text-bad" : undefined}>{pct(r.personal.mismatch)}</span>
                          </>
                        ) : (
                          <span className="text-text-3">needs another take</span>
                        )}
                      </td>
                      <td className="py-2">{r.confusedWith && (r.personal?.mismatch ?? r.generic.mismatch) > 0.05 ? <Pill tone="warn">{r.confusedWith}</Pill> : <span className="text-text-3">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-text-3">
              &ldquo;Wrongly flagged&rdquo; means the right chord was called a different one; that should be close to 0%. If a chord is often mistaken for another,
              re-record it or check the fingering. Chords that share most of their notes (like Em7 and G) are naturally hard to tell apart.
            </p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-line-soft pt-5">
        <Toggle
          checked={settings.usePersonalCalibration}
          onChange={(v) => updateSettings({ usePersonalCalibration: v })}
          label="Use my calibration when judging chords"
          description="Applies to every chord, in the studio, drills and free play. Turn it off to compare with the built-in templates."
        />
        <div className="flex items-center gap-3 text-sm text-text-3">
          {takes.length > 0 && <span>{takes.length} takes, last updated {relativeDate(cal.data.updatedAt)}.</span>}
          {takes.length > 0 && (
            <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
              Delete all takes
            </Button>
          )}
        </div>
      </section>
      <ConfirmDialog
        open={confirmClear}
        title="Delete all calibration takes?"
        body="Chord judging goes back to the built-in templates."
        confirmLabel="Delete takes"
        danger
        onClose={() => setConfirmClear(false)}
        onConfirm={() => saveCalibration((c) => ({ ...c, takes: [] }))}
      />
    </div>
  );
}
