"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, Input, Notice, Spinner, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { listSessions, listSongs, saveSettings } from "@/lib/db/db";
import { formatDuration, relativeDate, useLiveQuery, useSettings } from "@/lib/hooks";
import type { Song } from "@/lib/song/model";
import type { PracticeSession } from "@/lib/coach/types";
import { MODE_LABELS } from "@/lib/coach/types";

function SongRow({ song, meta }: { song: Song; meta?: string }) {
  return (
    <li>
      <Link href={`/song?id=${song.id}`} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2 transition-colors">
        <div className="min-w-0 flex-1">
          <p className="truncate text-text">{song.title}</p>
          <p className="truncate text-sm text-text-3">{[song.artist, meta].filter(Boolean).join(", ")}</p>
        </div>
        {song.favorite && <Icon name="star" size={15} className="text-accent shrink-0" />}
        <Icon name="chevronRight" size={16} className="text-text-3 opacity-0 group-hover:opacity-100 shrink-0" />
      </Link>
    </li>
  );
}

function Column({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <section className="min-w-0">
      <h2 className="text-[15px] text-text-2 font-semibold mb-2 px-3">{title}</h2>
      {empty ? <p className="px-3 text-sm text-text-3">Nothing here yet.</p> : <ul className="flex flex-col">{children}</ul>}
    </section>
  );
}

function weekStats(sessions: PracticeSession[]) {
  const weekAgo = Date.now() - 7 * 86400 * 1000;
  const week = sessions.filter((s) => new Date(s.startedAt).getTime() >= weekAgo);
  const seconds = week.reduce((a, s) => a + s.activeSec, 0);
  const days = new Set(week.map((s) => s.startedAt.slice(0, 10))).size;
  const evaluated = week.reduce((a, s) => a + s.summary.chordEvaluated, 0);
  const correct = week.reduce((a, s) => a + s.summary.correct, 0);
  return { count: week.length, seconds, days, accuracy: evaluated >= 10 ? correct / evaluated : null, evaluated };
}

export function Home() {
  const router = useRouter();
  const songs = useLiveQuery(listSongs, []);
  const sessions = useLiveQuery(() => listSessions(), []);
  const [settings] = useSettings();
  const [url, setUrl] = useState("");

  if (songs.status === "loading" || sessions.status === "loading") {
    return (
      <div className="p-8">
        <Spinner />
      </div>
    );
  }
  if (songs.status === "error") {
    return (
      <div className="p-8 max-w-[640px]">
        <Notice tone="bad" title="Your library couldn't be opened">
          {songs.error} GuitarCoach stores songs in this browser&apos;s storage, which may be disabled in private windows.
        </Notice>
      </div>
    );
  }
  const all = songs.data;
  const sess = sessions.status === "ready" ? sessions.data : [];

  const quickImport = (
    <form
      className="flex flex-col sm:flex-row gap-2 w-full max-w-[640px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) router.push(`/add?url=${encodeURIComponent(url.trim())}`);
      }}
    >
      <label htmlFor="home-url" className="sr-only">
        Song link
      </label>
      <Input id="home-url" className="flex-1 h-12 text-base" placeholder="Paste a song link" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
      <Button type="submit" variant="primary" size="lg" disabled={!url.trim()}>
        Import
      </Button>
    </form>
  );

  if (all.length === 0) {
    return (
      <div className="px-4 md:px-10 py-10 md:py-16 max-w-[880px]">
        <div className="flex flex-col gap-6">
          <EmptyFretboard />
          <div>
            <h1 className="text-[34px] leading-tight font-semibold tracking-tight">Add your first song</h1>
            <p className="mt-2 text-text-2 text-lg max-w-[56ch]">
              Paste a link to a chord sheet, or bring one in from a file or the clipboard. Then play along and GuitarCoach listens to how it goes.
            </p>
          </div>
          {quickImport}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/add?method=paste" icon="doc">
              Paste chords
            </ButtonLink>
            <ButtonLink href="/add?method=file" icon="upload">
              Upload a file
            </ButtonLink>
            <ButtonLink href="/add?method=audio" icon="wave">
              Start from a recording
            </ButtonLink>
            <ButtonLink href="/tuner" variant="ghost" icon="tuner">
              Tune up first
            </ButtonLink>
          </div>
          {!settings.storageNoticeDismissed && <StorageNotice />}
        </div>
      </div>
    );
  }

  const byPlayed = all.filter((s) => s.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!));
  const byAdded = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const favorites = all.filter((s) => s.favorite).sort((a, b) => a.title.localeCompare(b.title));
  const resume = byPlayed[0];
  const stats = weekStats(sess);
  const totalSec = sess.reduce((a, s) => a + s.activeSec, 0);

  return (
    <div className="px-4 md:px-10 py-8 max-w-[1180px] flex flex-col gap-10">
      <section className="flex flex-col lg:flex-row gap-6 lg:items-end justify-between">
        <div className="min-w-0">
          {resume ? (
            <>
              <p className="text-text-3 text-sm mb-1">Pick up where you left off</p>
              <h1 className="text-[34px] leading-tight font-semibold tracking-tight truncate">{resume.title}</h1>
              <p className="text-text-2">{resume.artist || "Unknown artist"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ButtonLink href={`/studio?song=${resume.id}`} variant="primary" size="lg" icon="play">
                  Resume practice
                </ButtonLink>
                <ButtonLink href={`/song?id=${resume.id}`} size="lg">
                  Song details
                </ButtonLink>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[34px] leading-tight font-semibold tracking-tight">Ready to play</h1>
              <p className="text-text-2">Pick a song below and open the Practice Studio.</p>
            </>
          )}
        </div>
        <div className="lg:w-[440px] shrink-0">{quickImport}</div>
      </section>

      <section aria-label="Practice this week" className="grid grid-cols-2 md:grid-cols-4 border-y border-line-soft">
        <Stat label="Practice this week" value={stats.seconds > 0 ? formatDuration(stats.seconds) : "None yet"} />
        <Stat label="Sessions this week" value={String(stats.count)} />
        <Stat label="Days practised" value={`${stats.days} of 7`} />
        <Stat
          label="Chords heard correctly"
          value={stats.accuracy === null ? "Not enough data" : `${Math.round(stats.accuracy * 100)}%`}
          hint={stats.accuracy === null ? "Needs 10+ measured chords this week" : `${stats.evaluated} chords measured`}
        />
      </section>

      <div className="grid gap-8 md:grid-cols-3">
        <Column title="Recently played" empty={byPlayed.length === 0}>
          {byPlayed.slice(0, 6).map((s) => (
            <SongRow key={s.id} song={s} meta={relativeDate(s.lastPlayedAt)} />
          ))}
        </Column>
        <Column title="Recently added" empty={false}>
          {byAdded.slice(0, 6).map((s) => (
            <SongRow key={s.id} song={s} meta={`added ${relativeDate(s.createdAt)}`} />
          ))}
        </Column>
        <Column title="Favorites" empty={favorites.length === 0}>
          {favorites.slice(0, 6).map((s) => (
            <SongRow key={s.id} song={s} />
          ))}
        </Column>
      </div>

      {sess.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[15px] text-text-2 font-semibold">Recent sessions</h2>
            <Link href="/progress" className="text-sm text-accent hover:underline">
              All progress
            </Link>
          </div>
          <ul className="divide-y divide-line-soft border-y border-line-soft">
            {sess.slice(0, 5).map((s) => (
              <li key={s.id}>
                <Link href={`/report?id=${s.id}`} className="flex items-center gap-4 py-2.5 px-1 hover:bg-surface transition-colors">
                  <span className="w-28 shrink-0 text-sm text-text-3">{relativeDate(s.startedAt)}</span>
                  <span className="min-w-0 flex-1 truncate">{s.songTitle || MODE_LABELS[s.mode]}</span>
                  <span className="text-sm text-text-3 hidden sm:block">{MODE_LABELS[s.mode]}</span>
                  <span className="text-sm text-text-2 tabular w-20 text-right">{formatDuration(s.activeSec)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-text-3">Total practice recorded: {formatDuration(totalSec)}.</p>
        </section>
      )}
      {!settings.storageNoticeDismissed && <StorageNotice />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="py-4 px-3 md:px-4 border-line-soft [&:not(:first-child)]:md:border-l">
      <p className="text-sm text-text-3">{label}</p>
      <p className={cx("mt-0.5 font-semibold tabular", value.length > 10 ? "text-base text-text-2" : "text-2xl")}>{value}</p>
      {hint && <p className="text-xs text-text-3 mt-0.5">{hint}</p>}
    </div>
  );
}

function StorageNotice() {
  return (
    <Notice
      tone="info"
      title="Your songs live in this browser"
      action={
        <>
          <ButtonLink href="/settings#data" size="sm">
            Back up now
          </ButtonLink>
          <Button size="sm" variant="ghost" onClick={() => saveSettings({ storageNoticeDismissed: true })}>
            Got it
          </Button>
        </>
      }
    >
      There&apos;s no account. Clearing this site&apos;s browser data deletes your songs and recordings unless you&apos;ve exported a backup.
    </Notice>
  );
}

function EmptyFretboard() {
  // A quiet fretboard sketch with a G chord shape — the first thing a new player sees.
  const strings = [0, 1, 2, 3, 4, 5];
  const dots = [
    { s: 0, f: 3 },
    { s: 1, f: 2 },
    { s: 5, f: 3 },
  ];
  return (
    <svg viewBox="0 0 420 120" className="w-full max-w-[420px] h-auto" aria-hidden="true">
      {strings.map((s) => (
        <line key={s} x1="20" x2="410" y1={15 + s * 18} y2={15 + s * 18} stroke="var(--text-3)" strokeWidth={1 + (5 - s) * 0.25} opacity="0.7" />
      ))}
      <rect x="16" y="12" width="5" height="96" fill="var(--text-2)" />
      {[1, 2, 3, 4, 5].map((f) => (
        <line key={f} x1={20 + f * 78} x2={20 + f * 78} y1="12" y2="108" stroke="var(--line)" strokeWidth="2" />
      ))}
      {dots.map((d) => (
        <circle key={`${d.s}-${d.f}`} cx={20 + (d.f - 0.5) * 78} cy={15 + (5 - d.s) * 18} r="7" fill="var(--accent)" />
      ))}
    </svg>
  );
}
