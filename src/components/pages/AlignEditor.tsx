"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, IconButton, Input, Notice, Pill, Select, Spinner, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SeekBar, TransportButtons } from "@/components/studio/parts";
import { getAudioBlob, getRecording, getSong, updateRecording, updateSong } from "@/lib/db/db";
import { useAnimationFrame, useLiveQuery, useSettings, formatTime } from "@/lib/hooks";
import { usePlayback } from "@/lib/studio/usePlayback";
import { buildTimeline } from "@/lib/song/timeline";
import { beatMapFor, eventTimes, fitTaps, statusLabel } from "@/lib/song/alignment";
import { decodeForAnalysis } from "@/lib/audio/analyzeFile";
import { estimateAlignment } from "@/lib/audio/attach";
import { getAudioContext, outputLatency } from "@/lib/audio/engine";
import { meterInfo } from "@/lib/music/meter";
import { nowIso, type Alignment, type Recording, type Song } from "@/lib/song/model";

export function AlignPage() {
  const params = useSearchParams();
  const songId = params.get("song") ?? "";
  const recId = params.get("rec") ?? "";
  const [version, setVersion] = useState(0);
  const q = useLiveQuery(
    async () => {
      const [song, rec, blob] = await Promise.all([getSong(songId), getRecording(recId), getAudioBlob(recId)]);
      return { song, rec, blob };
    },
    [songId, recId, version],
    { live: false },
  );
  if (q.status !== "ready") return <div className="p-8"><Spinner /></div>;
  const { song, rec, blob } = q.data;
  const isVideo = rec?.kind === "youtube" && !!rec.youtubeId;
  if (!song || !rec || (!blob && !isVideo)) {
    return (
      <div className="p-8 max-w-[560px]">
        <Notice tone="warn" title="Recording not found">
          It may have been deleted. <Link className="text-accent hover:underline" href={songId ? `/song?id=${songId}&tab=audio` : "/songs"}>Go back</Link>
        </Notice>
      </div>
    );
  }
  return <AlignEditor key={`${rec.id}:${version}`} song={song} rec={rec} blob={blob ?? null} onReload={() => setVersion((v) => v + 1)} />;
}

function AlignEditor({ song, rec, blob, onReload }: { song: Song; rec: Recording; blob: Blob | null; onReload: () => void }) {
  const youtubeId = rec.kind === "youtube" ? rec.youtubeId ?? null : null;
  const [videoEl, setVideoEl] = useState<HTMLDivElement | null>(null);
  const [settings] = useSettings();
  const meter = meterInfo(song.timeSignature);
  const [draft, setDraft] = useState<Alignment>(rec.alignment);
  const [lengths, setLengths] = useState<Record<string, number>>({}); // eventId -> bars
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState(70); // px per second
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [tapping, setTapping] = useState(false);
  const [tapStartEvent, setTapStartEvent] = useState(0);
  const [time, setTime] = useState(0);
  const laneRef = useRef<HTMLDivElement>(null);

  // Song with edited chord lengths applied (lengths affect the timeline for every recording).
  const workingSong = useMemo<Song>(() => {
    if (Object.keys(lengths).length === 0) return song;
    return {
      ...song,
      sections: song.sections.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, chords: l.chords.map((c) => (lengths[c.id] !== undefined ? { ...c, bars: lengths[c.id] } : c)) })) })),
    };
  }, [song, lengths]);
  const tl = useMemo(() => buildTimeline(workingSong), [workingSong]);
  const beatMap = useMemo(() => beatMapFor(draft), [draft]);
  const times = useMemo(() => eventTimes(tl, draft), [tl, draft]);

  const pb = usePlayback({
    blob,
    youtube: youtubeId ? { videoId: youtubeId, container: videoEl } : null,
    clockDuration: 0,
    beatMap,
    beatsPerBar: meter.beatsPerBar,
    subdivisionsPerBeat: meter.subdivisionsPerBeat,
    bpm: draft.bpm,
  });
  useEffect(() => {
    pb.setMetronomeOn(false);
    pb.setCountIn(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.transport]);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    decodeForAnalysis(blob)
      .then((a) => {
        if (cancelled) return;
        const buckets = Math.ceil(a.duration * 100); // 10 ms per bucket
        const per = Math.max(1, Math.floor(a.samples.length / buckets));
        const p = new Float32Array(buckets);
        for (let b = 0; b < buckets; b++) {
          let m = 0;
          for (let i = b * per; i < Math.min(a.samples.length, (b + 1) * per); i++) m = Math.max(m, Math.abs(a.samples[i]));
          p[b] = m;
        }
        setPeaks(p);
      })
      .catch(() => !cancelled && setMessage({ tone: "bad", text: "The audio couldn't be decoded for the waveform." }));
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useAnimationFrame(() => {
    const t = pb.getTime();
    if (Math.abs(t - time) > 0.03) setTime(t);
    if (pb.playing && laneRef.current) {
      const x = t * zoom;
      const el = laneRef.current;
      if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = x - el.clientWidth * 0.3;
    }
  }, true);

  const change = (a: Partial<Alignment>, method?: Alignment["methods"][number]) => {
    setDraft((d) => ({ ...d, ...a, methods: method && !d.methods.includes(method) ? [...d.methods, method] : d.methods, updatedAt: nowIso() }));
    setDirty(true);
  };

  const shift = (sec: number) => {
    change({ offsetSec: draft.offsetSec + sec, beatTimes: draft.beatTimes?.map((t) => t + sec), eventTimes: draft.eventTimes ? Object.fromEntries(Object.entries(draft.eventTimes).map(([k, v]) => [k, v + sec])) : undefined }, "manual");
  };

  const setEventTime = (key: string, t: number | null) => {
    const next = { ...(draft.eventTimes ?? {}) };
    if (t === null) delete next[key];
    else next[key] = Math.max(0, Math.round(t * 1000) / 1000);
    change({ eventTimes: next }, "manual");
  };

  const snap = useCallback(
    (t: number) => {
      const b = beatMap.timeToBeat(t);
      const nearest = beatMap.beatToTime(Math.round(b * 2) / 2);
      return Math.abs(nearest - t) < 0.08 ? nearest : t;
    },
    [beatMap],
  );

  const tap = useCallback(() => {
    if (!pb.playing) return;
    const heard = pb.getTime() - outputLatency(getAudioContext()) * pb.speed;
    setTaps((t) => [...t, heard]);
  }, [pb]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        tap();
      } else if (e.key === " ") {
        e.preventDefault();
        pb.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap, pb]);

  const applyTaps = () => {
    const fit = fitTaps(taps, 8);
    if (!fit) {
      setMessage({ tone: "warn", text: "Those taps weren't steady enough to set the beat. Try again, tapping every beat." });
      return;
    }
    const startBeat = tl.events[tapStartEvent]?.startBeat ?? 0;
    const spb = 60 / fit.bpm;
    change({ bpm: Math.round(fit.bpm * 100) / 100, offsetSec: fit.offsetSec - startBeat * spb, beatTimes: undefined, eventTimes: undefined, status: "calibrated" }, "tap");
    setTaps([]);
    setTapping(false);
    setMessage({ tone: "good", text: `Beat set from ${fit.taps} taps: ${fit.bpm.toFixed(1)} BPM, taps within ±${Math.round(fit.residualMs)} ms. Play it back with the click on to check, then save.` });
  };

  async function save(verified: boolean) {
    const status: Alignment["status"] = verified ? "verified" : draft.status === "none" || draft.status === "estimated" ? (dirty ? "calibrated" : draft.status) : draft.status;
    await updateRecording(rec.id, (r) => ({ ...r, alignment: { ...draft, status, updatedAt: nowIso() } }));
    if (Object.keys(lengths).length) {
      await updateSong(song.id, (s) => ({
        ...s,
        structureTiming: "verified",
        sections: s.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => ({ ...l, chords: l.chords.map((c) => (lengths[c.id] !== undefined ? { ...c, bars: lengths[c.id] } : c)) })) })),
      }));
    }
    setDraft((d) => ({ ...d, status }));
    setDirty(false);
    setLengths({});
    setMessage({ tone: "good", text: verified ? "Timing saved and marked as verified. Practice now gives millisecond timing feedback for this recording." : `Saved (${statusLabel(status).toLowerCase()}).` });
  }

  async function reestimate() {
    setBusy("Listening to the recording…");
    try {
      const r = await estimateAlignment(rec.id, settings.a4);
      setBusy(null);
      if (rec.alignment.status === "calibrated" || rec.alignment.status === "verified") {
        setMessage({ tone: "warn", text: "Your calibrated timing was kept. Reset it first if you want the automatic estimate." });
      } else onReload();
      void r;
    } catch (e) {
      setBusy(null);
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Analysis failed." });
    }
  }

  const duration = pb.duration || rec.durationSec || 1;
  const width = Math.max(600, duration * zoom);
  const beatCount = Math.ceil(beatMap.timeToBeat(duration)) + 1;
  const firstBeat = Math.floor(beatMap.timeToBeat(0));
  const laneH = 150;

  return (
    <div className="px-4 md:px-8 py-6 flex flex-col gap-5 max-w-[1400px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/song?id=${song.id}&tab=audio`} className="text-sm text-text-3 hover:text-text inline-flex items-center gap-1 mb-1">
            <Icon name="chevronLeft" size={15} /> {song.title}
          </Link>
          <h1 className="text-[28px] font-semibold leading-tight">Align timing</h1>
          <p className="text-text-2">{rec.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={draft.status === "verified" ? "good" : draft.status === "calibrated" ? "info" : "warn"}>{statusLabel(draft.status)}</Pill>
          {dirty && <Pill tone="warn">Unsaved changes</Pill>}
          <Button onClick={() => save(false)} disabled={!dirty}>
            Save
          </Button>
          <Button variant="primary" icon="check" onClick={() => save(true)}>
            Save as verified
          </Button>
        </div>
      </header>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {busy && <Spinner label={busy} />}
      {pb.loadError && <Notice tone="bad">{pb.loadError}</Notice>}
      {youtubeId && (
        <div className="w-full max-w-[480px] aspect-video bg-black rounded-lg overflow-hidden" data-testid="youtube-player">
          <div ref={setVideoEl} className="w-full h-full [&>*]:w-full [&>*]:h-full" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <TransportButtons playing={pb.playing} countingIn={false} onToggle={pb.toggle} onRestart={() => pb.seek(0)} disabled={!pb.ready} />
        <div className="flex-1 min-w-[240px]">
          <SeekBar time={time} duration={duration} onSeek={pb.seek} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pb.metronomeOn} onChange={(e) => pb.setMetronomeOn(e.target.checked)} className="accent-[var(--accent)]" />
          Click on the beat grid
        </label>
        <label className="flex items-center gap-2 text-sm">
          Zoom
          <input type="range" min={20} max={240} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
        </label>
      </div>

      {/* Timeline lane */}
      <div ref={laneRef} className="overflow-x-auto scroll-thin rounded-xl border border-line-soft bg-sunk" data-testid="align-lane">
        <svg width={width} height={laneH} className="block select-none" onClick={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          pb.seek((e.clientX - rect.left) / zoom);
        }}>
          {peaks &&
            (() => {
              const step = Math.max(1, Math.floor(100 / zoom));
              const pts: string[] = [];
              for (let i = 0; i < peaks.length; i += step) {
                const x = (i / 100) * zoom;
                const h = Math.min(1, peaks[i] * 1.6) * 40;
                pts.push(`M${x.toFixed(1)},${95 - h}V${95 + h}`);
              }
              return <path d={pts.join("")} stroke="var(--surface-3)" strokeWidth={1} />;
            })()}
          {Array.from({ length: beatCount - firstBeat }, (_, i) => {
            const b = firstBeat + i;
            const t = beatMap.beatToTime(b);
            if (t < 0 || t > duration) return null;
            const bar = b % meter.beatsPerBar === 0;
            return <line key={b} x1={t * zoom} x2={t * zoom} y1={bar ? 40 : 60} y2={laneH} stroke={bar ? "var(--text-3)" : "var(--line)"} strokeWidth={1} />;
          })}
          {tl.events.map((e, i) => {
            const t = times[i];
            const x = t.start * zoom;
            const w = Math.max(2, (t.end - t.start) * zoom);
            return (
              <g key={e.key}>
                <rect x={x} y={6} width={w - 2} height={28} rx={4} fill={t.manual ? "var(--info-wash)" : "var(--accent-wash)"} stroke={t.manual ? "var(--info)" : "var(--accent-line)"} />
                <text x={x + 6} y={25} fontSize={13} fill="var(--chord)" fontFamily="var(--font-chord)" fontWeight={600}>
                  {w > 24 ? e.chord : ""}
                </text>
                <rect
                  x={x - 5}
                  y={4}
                  width={10}
                  height={32}
                  fill="transparent"
                  className="cursor-ew-resize"
                  onClick={(ev) => ev.stopPropagation()}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    const svg = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
                    const move = (m: PointerEvent) => {
                      const tt = (m.clientX - svg.left) / zoom;
                      setEventTime(e.key, m.altKey ? tt : snap(tt));
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  <title>{`Drag to move the change to ${e.chord}`}</title>
                </rect>
              </g>
            );
          })}
          {taps.map((t, i) => (
            <line key={i} x1={t * zoom} x2={t * zoom} y1={36} y2={laneH} stroke="var(--warn)" strokeWidth={2} />
          ))}
          <line x1={time * zoom} x2={time * zoom} y1={0} y2={laneH} stroke="var(--chord)" strokeWidth={2} />
        </svg>
      </div>
      <p className="text-sm text-text-3">
        Chord changes sit on top, the beat grid below (taller lines start a bar). Drag the left edge of a chord to move its change; it snaps to the nearest half-beat
        unless you hold Alt. Click the lane to jump there.
      </p>

      <div className="grid gap-8 lg:grid-cols-3">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Tap along</h2>
          <p className="text-sm text-text-2">Play the recording and tap T (or the button) on every beat, starting on the first beat of the chord you choose. Eight or more steady taps set the tempo and where the song starts.</p>
          <Field label="My first tap is on" htmlFor="tap-start">
            <Select id="tap-start" value={tapStartEvent} onChange={(e) => setTapStartEvent(Number(e.target.value))}>
              {tl.events.slice(0, 40).map((e, i) => (
                <option key={e.key} value={i}>
                  {e.sectionName || "Song"}: {e.chord} ({formatTime(times[i].start)})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            {!tapping ? (
              <Button
                variant="primary"
                onClick={() => {
                  setTaps([]);
                  setTapping(true);
                  pb.seek(Math.max(0, times[tapStartEvent].start - 4));
                  void pb.play();
                }}
              >
                Start tapping
              </Button>
            ) : (
              <>
                <Button variant="primary" size="lg" onPointerDown={tap}>
                  Tap ({taps.length})
                </Button>
                <Button onClick={applyTaps} disabled={taps.length < 8}>
                  Use these taps
                </Button>
                <Button variant="ghost" onClick={() => { setTapping(false); setTaps([]); pb.pause(); }}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Adjust the whole timeline</h2>
          <div className="flex flex-wrap gap-1.5">
            {[-60 / draft.bpm, -0.05, -0.01, 0.01, 0.05, 60 / draft.bpm].map((d) => (
              <Button key={d} size="sm" onClick={() => shift(d)}>
                {Math.abs(Math.abs(d) - 60 / draft.bpm) < 1e-6 ? `${d < 0 ? "−" : "+"}1 beat` : `${d < 0 ? "−" : "+"}${Math.round(Math.abs(d) * 1000)} ms`}
              </Button>
            ))}
          </div>
          <Field label="Tempo (BPM)" htmlFor="al-bpm" hint={draft.beatTimes ? "This recording uses a measured beat grid; tap along to replace it with a steady tempo." : undefined}>
            <Input id="al-bpm" type="number" step={0.1} min={30} max={300} value={draft.bpm} className="w-28" onChange={(e) => change({ bpm: Number(e.target.value) || draft.bpm, beatTimes: undefined }, "manual")} />
          </Field>
          <Field label="Song starts at (seconds)" htmlFor="al-offset">
            <Input id="al-offset" type="number" step={0.01} value={Math.round((draft.beatTimes?.[0] ?? draft.offsetSec) * 100) / 100} className="w-28" onChange={(e) => shift((Number(e.target.value) || 0) - (draft.beatTimes?.[0] ?? draft.offsetSec))} />
          </Field>
          <Button variant="ghost" size="sm" onClick={() => pb.seek(Math.max(0, (draft.beatTimes?.[0] ?? draft.offsetSec) - 2))}>
            Play from just before the start
          </Button>
        </section>

        {!youtubeId && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Automatic estimate</h2>
          <p className="text-sm text-text-2">GuitarCoach finds the beat and matches the chords against the audio. It&apos;s a starting point; check it with the click.</p>
          <div>
            <Button onClick={reestimate} disabled={!!busy}>
              Estimate from the audio
            </Button>
          </div>
          {rec.analysis && (
            <p className="text-sm text-text-3">
              Last analysis: {rec.analysis.bpm ? `${Math.round(rec.analysis.bpm)} BPM` : "no steady beat"}, beat confidence {Math.round(rec.analysis.bpmConfidence * 100)}%.
            </p>
          )}
        </section>
        )}
      </div>

      <section>
        <h2 className="font-semibold mb-2">Chord changes</h2>
        <p className="text-sm text-text-3 mb-3">Lengths apply to the song itself (every recording); change times apply to this recording only.</p>
        <div className="max-h-[420px] overflow-y-auto scroll-thin border-y border-line-soft">
          <table className="w-full text-sm">
            <thead className="text-text-3 text-left sticky top-0 bg-bg">
              <tr>
                <th className="py-2 font-normal">Section</th>
                <th className="py-2 font-normal">Chord</th>
                <th className="py-2 font-normal">Starts</th>
                <th className="py-2 font-normal">Length (beats)</th>
                <th className="py-2 font-normal sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tl.events.map((e, i) => {
                const t = times[i];
                const active = time >= t.start && time < t.end;
                return (
                  <tr key={e.key} className={cx("border-t border-line-soft", active && "bg-accent-wash")}>
                    <td className="py-1.5 text-text-3">{e.sectionName || "Song"}</td>
                    <td className="py-1.5 chord-face text-base text-chord">{e.chord}</td>
                    <td className="py-1.5 tabular">
                      {formatTime(t.start)}.{String(Math.floor((t.start % 1) * 100)).padStart(2, "0")}
                      {t.manual && <span className="text-info ml-1">(set by hand)</span>}
                    </td>
                    <td className="py-1.5">
                      <Input
                        type="number"
                        aria-label={`Length of ${e.chord} in beats`}
                        min={0.5}
                        max={32}
                        step={0.5}
                        value={Math.round(e.beats * 100) / 100}
                        className="w-20 h-8"
                        onChange={(ev) => {
                          const beats = Number(ev.target.value);
                          if (beats > 0) {
                            setLengths((l) => ({ ...l, [e.eventId]: beats / meter.beatsPerBar }));
                            setDirty(true);
                          }
                        }}
                      />
                      {e.estimated && lengths[e.eventId] === undefined && <span className="text-text-3 ml-2">guessed</span>}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <IconButton icon="play" label={`Play from ${e.chord}`} size={30} onClick={() => { pb.seek(Math.max(0, t.start - 1)); void pb.play(); }} />
                      <Button size="sm" variant="ghost" onClick={() => setEventTime(e.key, pb.getTime() - outputLatency(getAudioContext()))}>
                        Set to now
                      </Button>
                      {t.manual && (
                        <Button size="sm" variant="ghost" onClick={() => setEventTime(e.key, null)}>
                          Reset
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
