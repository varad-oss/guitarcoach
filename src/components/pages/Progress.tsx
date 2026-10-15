"use client";

import Link from "next/link";
import { ButtonLink, PageHeader, Spinner } from "@/components/ui";
import { ColumnChart, PercentDots } from "@/components/charts";
import { listSessions } from "@/lib/db/db";
import { formatDuration, relativeDate, useLiveQuery } from "@/lib/hooks";
import { difficultTransitions } from "@/lib/coach/evaluate";
import { MODE_LABELS, type PracticeSession } from "@/lib/coach/types";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function Progress() {
  const q = useLiveQuery(() => listSessions(), []);
  if (q.status !== "ready") return <div className="p-8"><Spinner /></div>;
  const sessions = q.data;

  if (sessions.length === 0) {
    return (
      <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[900px]">
        <PageHeader title="Progress" />
        <div className="rounded-xl border border-line-soft px-6 py-12 text-center flex flex-col items-center gap-3">
          <p className="text-lg">No practice recorded yet</p>
          <p className="text-text-2 max-w-[52ch]">Finish a session in the Practice Studio and your time, chord accuracy and timing will appear here. Nothing is shown until you&apos;ve actually played.</p>
          <ButtonLink href="/studio" variant="primary" icon="play">
            Open the Practice Studio
          </ButtonLink>
        </div>
      </div>
    );
  }

  const totalSec = sessions.reduce((a, s) => a + s.activeSec, 0);
  const days: Array<{ label: string; key: string; minutes: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), minutes: 0 });
  }
  for (const s of sessions) {
    const k = dayKey(new Date(s.startedAt));
    const d = days.find((x) => x.key === k);
    if (d) d.minutes += s.activeSec / 60;
  }
  const activeDays = new Set(sessions.map((s) => dayKey(new Date(s.startedAt)))).size;
  const measured = sessions.filter((s) => s.summary.chordAccuracy !== null && s.summary.chordEvaluated >= 5).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const allResults = sessions
    .filter((s) => ["learn", "full-song", "performance"].includes(s.mode))
    .flatMap((s) => s.chordResults.map((r) => ({ ...r, key: `${s.id}:${r.key}`, index: r.index + new Date(s.startedAt).getTime() })));
  const hard = difficultTransitions(allResults, 3);
  const transitionTimes = new Map<string, number[]>();
  for (const s of sessions) for (const t of s.transitions ?? []) transitionTimes.set(`${t.from} → ${t.to}`, [...(transitionTimes.get(`${t.from} → ${t.to}`) ?? []), ...t.times]);

  const bySong = new Map<string, { title: string; songId: string | null; sessions: PracticeSession[] }>();
  for (const s of sessions) {
    if (!s.songTitle) continue;
    const k = s.songId ?? s.songTitle;
    const e = bySong.get(k) ?? { title: s.songTitle, songId: s.songId, sessions: [] };
    e.sessions.push(s);
    bySong.set(k, e);
  }

  return (
    <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[1200px] flex flex-col gap-10">
      <PageHeader title="Progress" description="Everything here comes from sessions you've finished on this device." />

      <section className="grid grid-cols-2 md:grid-cols-4 border-y border-line-soft">
        {[
          ["Total practice", formatDuration(totalSec)],
          ["Sessions", String(sessions.length)],
          ["Days practised", String(activeDays)],
          ["Songs practised", String(bySong.size)],
        ].map(([label, value]) => (
          <div key={label} className="py-4 px-3 [&:not(:first-child)]:md:border-l border-line-soft">
            <p className="text-sm text-text-3">{label}</p>
            <p className="text-2xl font-semibold tabular">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">Minutes practised, last 14 days</h2>
          <ColumnChart
            title="Minutes practised per day over the last 14 days"
            unit="min"
            data={days.map((d) => ({ label: d.label, value: d.minutes, tip: `${d.label}: ${d.minutes < 10 ? d.minutes.toFixed(1) : Math.round(d.minutes)} min` }))}
          />
        </section>
        <section>
          <h2 className="text-lg font-semibold">Chord accuracy per session</h2>
          {measured.length === 0 ? (
            <p className="text-text-3 mt-2">Appears once a session has at least five chords judged from the microphone.</p>
          ) : (
            <>
              <PercentDots
                title="Chord accuracy for each measured session"
                data={measured.map((s) => ({
                  x: new Date(s.startedAt).getTime(),
                  y: s.summary.chordAccuracy!,
                  tip: `${s.songTitle || MODE_LABELS[s.mode]}, ${relativeDate(s.startedAt)}: ${Math.round(s.summary.chordAccuracy! * 100)}% of ${s.summary.chordEvaluated}`,
                }))}
              />
              <p className="text-sm text-text-3">Only chords that could be judged clearly are counted.</p>
            </>
          )}
        </section>
      </div>

      {(hard.length > 0 || transitionTimes.size > 0) && (
        <section className="grid gap-10 lg:grid-cols-2">
          {hard.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Changes that trip you up</h2>
              <ul className="flex flex-col gap-2">
                {hard.slice(0, 6).map((t) => (
                  <li key={`${t.from}-${t.to}`} className="flex items-center gap-3">
                    <span className="chord-face text-xl text-chord w-28">
                      {t.from} → {t.to}
                    </span>
                    <span className="text-sm text-text-3 flex-1">
                      {t.problems} of {t.attempts} went wrong
                    </span>
                    <Link className="text-sm text-accent hover:underline" href={`/studio?mode=transition&pair=${encodeURIComponent(t.from)}~${encodeURIComponent(t.to)}`}>
                      Practise
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {transitionTimes.size > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Chord-change trainer</h2>
              <ul className="flex flex-col gap-1.5">
                {[...transitionTimes.entries()].map(([k, times]) => (
                  <li key={k} className="flex gap-3 items-baseline">
                    <span className="chord-face text-xl text-chord w-28">{k}</span>
                    <span className="text-sm text-text-2">
                      {times.length ? `${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(2)} s average over ${times.length} clean changes` : "no clean changes yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {bySong.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-2">By song</h2>
          <table className="w-full text-[15px]">
            <thead className="text-sm text-text-3 text-left">
              <tr className="border-b border-line-soft">
                <th className="py-2 font-normal">Song</th>
                <th className="py-2 font-normal">Sessions</th>
                <th className="py-2 font-normal">Time</th>
                <th className="py-2 font-normal">Last accuracy</th>
                <th className="py-2 font-normal">Last played</th>
              </tr>
            </thead>
            <tbody>
              {[...bySong.values()].map((e) => {
                const last = e.sessions.find((s) => s.summary.chordAccuracy !== null);
                return (
                  <tr key={e.title} className="border-b border-line-soft">
                    <td className="py-2">{e.songId ? <Link className="hover:underline" href={`/song?id=${e.songId}&tab=history`}>{e.title}</Link> : e.title}</td>
                    <td className="py-2 tabular">{e.sessions.length}</td>
                    <td className="py-2 tabular">{formatDuration(e.sessions.reduce((a, s) => a + s.activeSec, 0))}</td>
                    <td className="py-2 tabular">{last ? `${Math.round(last.summary.chordAccuracy! * 100)}%` : "—"}</td>
                    <td className="py-2 text-text-2">{relativeDate(e.sessions[0].startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">All sessions</h2>
        <ul className="divide-y divide-line-soft border-y border-line-soft">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/report?id=${s.id}`} className="flex flex-wrap items-center gap-4 py-2.5 px-1 hover:bg-surface">
                <span className="w-32 text-sm text-text-3">{relativeDate(s.startedAt)}</span>
                <span className="flex-1 min-w-0 truncate">{s.songTitle || MODE_LABELS[s.mode]}</span>
                <span className="text-sm text-text-3 w-28">{MODE_LABELS[s.mode]}</span>
                <span className="text-sm tabular w-16 text-right">{formatDuration(s.activeSec)}</span>
                <span className="text-sm tabular w-28 text-right text-text-2">{s.summary.chordAccuracy === null ? "not measured" : `${Math.round(s.summary.chordAccuracy * 100)}% correct`}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
