"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ButtonLink, ConfirmDialog, Button, Notice, Pill, Spinner, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ResultStrip } from "@/components/charts";
import { TempoSparkline } from "@/components/studio/Drills";
import { deleteSession, getSession } from "@/lib/db/db";
import { formatDuration, useLiveQuery } from "@/lib/hooks";
import { difficultTransitions } from "@/lib/coach/evaluate";
import { MODE_LABELS, type ChordResult, type PracticeSession } from "@/lib/coach/types";
import { statusLabel } from "@/lib/song/alignment";

function pct(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)}%`;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="border-t border-line-soft pt-3">
      <p className="text-sm text-text-3">{label}</p>
      <p className={cx("text-[28px] leading-tight font-semibold tabular", tone === "good" && "text-accent", tone === "bad" && "text-bad")}>{value}</p>
      {detail && <p className="text-sm text-text-3 mt-0.5">{detail}</p>}
    </div>
  );
}

function sectionProblems(results: ChordResult[]) {
  const map = new Map<string, { key: string; name: string; problems: number; checked: number; lines: Set<number> }>();
  for (const r of results) {
    const [si, sr] = r.key.split(".");
    const key = `${si}.${sr}`;
    const e = map.get(key) ?? { key, name: r.sectionName || "Song", problems: 0, checked: 0, lines: new Set<number>() };
    if (r.verdict === "correct" || r.verdict === "wrong" || r.verdict === "missed") e.checked++;
    const bad = r.verdict === "wrong" || r.verdict === "missed" || r.timing === "late" || r.timing === "early" || r.timing === "missed";
    if (bad) {
      e.problems++;
      e.lines.add(r.lineIndex + 1);
    }
    map.set(key, e);
  }
  return [...map.values()].filter((e) => e.problems > 0).sort((a, b) => b.problems - a.problems);
}

export function Report() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const q = useLiveQuery(() => getSession(id), [id]);
  if (q.status === "loading") return <div className="p-8"><Spinner /></div>;
  if (q.status === "error" || !q.data) {
    return (
      <div className="p-8 max-w-[560px]">
        <Notice tone="warn" title="Session not found" action={<ButtonLink href="/progress">Open Progress</ButtonLink>} />
      </div>
    );
  }
  return <ReportView s={q.data} />;
}

function ReportView({ s }: { s: PracticeSession }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const sum = s.summary;
  const wrong = s.chordResults.filter((r) => r.verdict === "wrong");
  const wrongPairs = new Map<string, number>();
  for (const r of wrong) wrongPairs.set(`${r.expected}→${r.detected}`, (wrongPairs.get(`${r.expected}→${r.detected}`) ?? 0) + 1);
  const transitions = difficultTransitions(s.chordResults);
  const problems = sectionProblems(s.chordResults);
  const msTiming = s.timingSource === "clock" || s.timingSource === "calibrated" || s.timingSource === "verified";
  const isPlayAlong = ["learn", "full-song", "performance"].includes(s.mode);

  return (
    <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[1200px] flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-text-3">
            {new Date(s.startedAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}
          </p>
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{s.songTitle || MODE_LABELS[s.mode]}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Pill>{MODE_LABELS[s.mode]}</Pill>
            <Pill>{formatDuration(s.activeSec)} played</Pill>
            {s.bpm > 0 && <Pill>{Math.round(s.bpm)} BPM{s.speed !== 1 ? ` (${Math.round(s.speed * 100)}% speed)` : ""}</Pill>}
            {isPlayAlong && <Pill tone={msTiming ? "good" : "warn"}>{s.timingSource === "clock" ? "Metronome timing" : statusLabel(s.timingSource)}</Pill>}
            {!s.micUsed && <Pill tone="warn">Listening was off</Pill>}
          </div>
        </div>
        <div className="flex gap-2">
          {s.songId && (
            <ButtonLink href={`/studio?song=${s.songId}&mode=${isPlayAlong ? s.mode : "full-song"}`} variant="primary" icon="play">
              Practise again
            </ButtonLink>
          )}
          <Button variant="ghost" icon="trash" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      </header>

      {!s.micUsed && (s.mode !== "free-play") && (
        <Notice tone="info">This session was played without listening, so chords and timing weren&apos;t checked. Turn on “Listen to me” next time for feedback.</Notice>
      )}
      {s.micUsed && s.signalQuality !== null && s.signalQuality < 0.25 && isPlayAlong && (
        <Notice tone="warn">
          The microphone heard a clear guitar sound only {Math.round(s.signalQuality * 100)}% of the time, so many chords couldn&apos;t be judged. Move closer to
          the microphone or reduce background noise.
        </Notice>
      )}

      {sum.chordTotal > 0 && (
        <section className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Chords correct"
            value={pct(sum.chordAccuracy)}
            detail={sum.chordEvaluated ? `${sum.correct} of ${sum.chordEvaluated} judged${sum.uncertain ? `; ${sum.uncertain} unclear, not counted` : ""}` : "Nothing could be judged"}
            tone={sum.chordAccuracy !== null && sum.chordAccuracy >= 0.8 ? "good" : undefined}
          />
          <Metric
            label="Changes on time"
            value={msTiming ? pct(sum.timingAccuracy) : "Not timed"}
            detail={
              msTiming
                ? sum.timingEvaluated
                  ? `${sum.onTime} of ${sum.timingEvaluated}; ${sum.early} early, ${sum.late} late`
                  : "No changes could be timed"
                : "The recording's timing is estimated; align it to get timing feedback"
            }
          />
          <Metric label="Average timing error" value={msTiming && sum.meanAbsOffsetMs !== null ? `${sum.meanAbsOffsetMs} ms` : "—"} detail={msTiming ? "across timed changes" : undefined} />
          <Metric label="Wrong or missed chords" value={String(sum.wrong + sum.missed)} detail={`${sum.wrong} wrong, ${sum.missed} missed`} tone={sum.wrong + sum.missed > 0 ? "bad" : undefined} />
        </section>
      )}

      {s.chordResults.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Chord by chord</h2>
          <ResultStrip results={[...s.chordResults].sort((a, b) => a.index - b.index)} />
        </section>
      )}

      {problems.length > 0 && s.songId && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Where it went wrong</h2>
          <ul className="divide-y divide-line-soft border-y border-line-soft">
            {problems.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p>{p.name}</p>
                  <p className="text-sm text-text-3">
                    {p.problems} problem{p.problems === 1 ? "" : "s"}, around line{p.lines.size === 1 ? "" : "s"} {[...p.lines].sort((a, b) => a - b).join(", ")}
                  </p>
                </div>
                <ButtonLink href={`/studio?song=${s.songId}&mode=learn&loop=${p.key}`} size="sm" icon="loop">
                  Practise this section
                </ButtonLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(wrongPairs.size > 0 || transitions.length > 0) && (
        <section className="grid gap-8 md:grid-cols-2">
          {wrongPairs.size > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Wrong chords</h2>
              <ul className="flex flex-col gap-1.5 max-w-[320px]">
                {[...wrongPairs.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => {
                    const [exp, heard] = k.split("→");
                    return (
                      <li key={k} className="flex items-baseline gap-2">
                        <span className="text-text-3 text-sm w-20">Expected</span>
                        <span className="chord-face text-xl text-chord">{exp}</span>
                        <span className="text-text-3 text-sm">heard</span>
                        <span className="chord-face text-xl text-bad">{heard}</span>
                        <span className="text-sm text-text-3 ml-auto">×{n}</span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}
          {transitions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Hardest changes</h2>
              <ul className="flex flex-col gap-2">
                {transitions.slice(0, 5).map((t) => (
                  <li key={`${t.from}-${t.to}`} className="flex items-center gap-3">
                    <span className="chord-face text-xl text-chord w-28">
                      {t.from} → {t.to}
                    </span>
                    <span className="text-sm text-text-3 flex-1">
                      {t.problems} of {t.attempts} went wrong
                    </span>
                    <Link href={`/studio?mode=transition&pair=${encodeURIComponent(t.from)}~${encodeURIComponent(t.to)}${s.songId ? `&song=${s.songId}` : ""}`} className="text-sm text-accent hover:underline">
                      Practise
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {s.strum && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Strumming</h2>
          {s.strum.evaluated ? (
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-4">
              <Metric label="On the pattern" value={`${s.strum.matched} of ${s.strum.expected}`} />
              <Metric label="Missed strums" value={String(s.strum.missed)} />
              <Metric label="Extra strums" value={String(s.strum.extra)} />
              <Metric label="Consistency" value={s.strum.stdOffsetMs !== null ? `±${s.strum.stdOffsetMs} ms` : "—"} detail={s.strum.meanAbsOffsetMs !== null ? `average ${s.strum.meanAbsOffsetMs} ms off the beat` : undefined} />
            </div>
          ) : (
            <p className="text-text-3">Strumming wasn&apos;t evaluated in this session.</p>
          )}
          <p className="text-sm text-text-3 mt-2">Strum timing is measured; strum direction is not.</p>
        </section>
      )}

      {s.tempo && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Tempo</h2>
          {s.tempo.estimatedBpm !== null ? (
            <div className="grid gap-6 sm:grid-cols-[repeat(2,minmax(0,200px))_1fr] items-start">
              <Metric label="Your tempo" value={`${Math.round(s.tempo.estimatedBpm)} BPM`} detail={`target ${Math.round(s.tempo.targetBpm)} BPM`} />
              <Metric label="Steadiness" value={s.tempo.driftPct !== null ? `${s.tempo.driftPct}%` : "—"} detail="variation between beats (lower is steadier)" />
              <TempoSparkline curve={s.tempo.samples} target={s.tempo.targetBpm} />
            </div>
          ) : (
            <p className="text-text-3">Not enough steady strums ({s.tempo.onsetCount}) to estimate your tempo reliably.</p>
          )}
        </section>
      )}

      {s.transitions && s.transitions.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Chord changes</h2>
          <table className="text-[15px]">
            <thead className="text-sm text-text-3 text-left">
              <tr>
                <th className="pr-8 font-normal">Change</th>
                <th className="pr-8 font-normal">Clean</th>
                <th className="pr-8 font-normal">Attempts</th>
                <th className="font-normal">Average time</th>
              </tr>
            </thead>
            <tbody>
              {s.transitions.map((t, i) => (
                <tr key={i}>
                  <td className="pr-8 chord-face text-lg">
                    {t.from} → {t.to}
                  </td>
                  <td className="pr-8 tabular">{t.successes}</td>
                  <td className="pr-8 tabular">{t.attempts}</td>
                  <td className="tabular">{t.times.length ? `${(t.times.reduce((a, b) => a + b, 0) / t.times.length / 1000).toFixed(2)} s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.mode === "free-play" && <p className="text-text-2">Free play sessions record your practice time only.</p>}

      <p className="text-sm text-text-3 flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
        Results come from analysing your microphone audio on this device. Unclear moments are left out rather than counted as mistakes.
      </p>

      <ConfirmDialog
        open={confirm}
        title="Delete this session?"
        body="It will be removed from your practice history."
        confirmLabel="Delete session"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await deleteSession(s.id);
          router.push("/progress");
        }}
      />
    </div>
  );
}
