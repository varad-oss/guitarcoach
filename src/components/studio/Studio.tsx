"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ButtonLink, Notice, PageHeader, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { PlayAlong } from "./PlayAlong";
import { ChordDrill, FreePlay, RhythmDrill, TransitionTrainer } from "./Drills";
import { useMemo, useState } from "react";
import { getAudioBlob, getSong, listRecordings, listSongs, updateSong } from "@/lib/db/db";
import { applyDisplay, prefsOf } from "@/lib/music/display";
import { DEFAULT_DISPLAY, type DisplayPrefs } from "@/lib/song/model";
import { relativeDate, useLiveQuery, useSettings } from "@/lib/hooks";
import type { PracticeMode } from "@/lib/coach/types";
import type { Recording, Song } from "@/lib/song/model";

const PLAY_MODES: PracticeMode[] = ["learn", "full-song", "performance"];

interface Loaded {
  song: Song | null;
  recording: Recording | null;
  blob: Blob | null;
}

function isYouTube(r: Recording | null): boolean {
  return r?.kind === "youtube" && !!r.youtubeId;
}

async function loadStudio(songId: string | null, useRecording: boolean): Promise<Loaded> {
  if (!songId) return { song: null, recording: null, blob: null };
  const song = (await getSong(songId)) ?? null;
  if (!song) return { song: null, recording: null, blob: null };
  if (!useRecording || !song.activeRecordingId) return { song, recording: null, blob: null };
  const recs = await listRecordings(song.id);
  const recording = recs.find((r) => r.id === song.activeRecordingId) ?? null;
  if (isYouTube(recording)) return { song, recording, blob: null };
  const blob = recording ? (await getAudioBlob(recording.id)) ?? null : null;
  return { song, recording: blob ? recording : null, blob };
}

export function Studio() {
  const params = useSearchParams();
  const router = useRouter();
  const songId = params.get("song");
  const mode = (params.get("mode") as PracticeMode) || (songId ? "full-song" : null);
  const source = params.get("source") === "metronome" ? "metronome" : "recording";
  const [settings, , settingsReady] = useSettings();
  // Song content is read once per visit so live edits elsewhere don't reset a running session.
  const data = useLiveQuery(() => loadStudio(songId, source === "recording"), [songId, source], { live: false });
  const loadedSong = data.status === "ready" ? data.data.song : null;
  const [prefsOverride, setPrefsOverride] = useState<DisplayPrefs | null>(null);
  const prefs = prefsOverride ?? (loadedSong ? prefsOf(loadedSong) : DEFAULT_DISPLAY);
  const playedSong = useMemo(() => (loadedSong ? applyDisplay(loadedSong, prefs) : null), [loadedSong, prefs]);
  const changePrefs = (p: DisplayPrefs) => {
    setPrefsOverride(p);
    if (loadedSong) void updateSong(loadedSong.id, (s) => ({ ...s, display: p }), { userEdit: false });
  };

  const setMode = (m: PracticeMode) => {
    const q = new URLSearchParams(params.toString());
    q.set("mode", m);
    router.replace(`/studio?${q.toString()}`);
  };

  if (!mode) return <StudioHome />;
  if (data.status === "loading" || !settingsReady) return <div className="p-8"><Spinner label="Preparing the studio…" /></div>;
  if (data.status === "error") return <div className="p-8"><Notice tone="bad">{data.error}</Notice></div>;
  const { song: storedSong, recording, blob } = data.data;
  const song = playedSong ?? storedSong;

  if (songId && !song) {
    return (
      <div className="p-8 max-w-[560px]">
        <Notice tone="warn" title="Song not found" action={<ButtonLink href="/studio">Choose another song</ButtonLink>}>
          It may have been deleted from this device.
        </Notice>
      </div>
    );
  }

  switch (mode) {
    case "free-play":
      return <FreePlay settings={settings} song={song} />;
    case "chord-drill":
      return <ChordDrill settings={settings} song={song} />;
    case "rhythm-drill":
      return <RhythmDrill settings={settings} song={song} />;
    case "transition": {
      const pair = params.get("pair")?.split("~") as [string, string] | undefined;
      return <TransitionTrainer settings={settings} song={song} initialPair={pair && pair.length === 2 ? pair : null} />;
    }
    default:
      if (!song) return <StudioHome />;
      return (
        <PlayAlong
          key={`${song.id}:${recording?.id ?? "clock"}:${PLAY_MODES.includes(mode) ? "play" : mode}`}
          song={song}
          recording={recording}
          blob={blob}
          mode={PLAY_MODES.includes(mode) ? mode : "full-song"}
          settings={settings}
          storedSong={storedSong!}
          prefs={prefs}
          onPrefsChange={changePrefs}
          initialLoopKey={params.get("loop")}
          onModeChange={setMode}
        />
      );
  }
}

const TOOLS: Array<{ href: string; title: string; text: string; icon: IconName }> = [
  { href: "/studio?mode=free-play", title: "Free play", text: "See which chord GuitarCoach hears as you play.", icon: "wave" },
  { href: "/studio?mode=transition", title: "Chord changes", text: "Time your switches between two chords.", icon: "loop" },
  { href: "/studio?mode=rhythm-drill", title: "Rhythm drill", text: "Strum a pattern to the click and see your timing.", icon: "metronome" },
  { href: "/studio?mode=chord-drill", title: "Chord drill", text: "Play shapes until each one rings clearly.", icon: "hand" },
  { href: "/tuner", title: "Tuner", text: "Standard tuning, with cents and confidence.", icon: "tuner" },
  { href: "/calibrate", title: "Chord calibration", text: "Teach it how your guitar sounds, and see how well your chords are recognised.", icon: "target" },
];

function StudioHome() {
  const songs = useLiveQuery(listSongs, []);
  const list = songs.status === "ready" ? [...songs.data].sort((a, b) => (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt)) : [];
  return (
    <div className="px-4 md:px-8 py-6 max-w-[1100px]">
      <PageHeader title="Practice Studio" description="Pick a song to play along with, or use one of the tools." />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <h2 className="text-[15px] text-text-2 font-semibold mb-2">Songs</h2>
          {songs.status === "loading" ? (
            <Spinner />
          ) : list.length === 0 ? (
            <Notice tone="info" action={<ButtonLink href="/add" variant="primary" icon="plus">Add a song</ButtonLink>}>
              Add a song to play along with it here. The tools on the right work without one.
            </Notice>
          ) : (
            <ul className="divide-y divide-line-soft border-y border-line-soft">
              {list.slice(0, 30).map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{s.title}</p>
                    <p className="truncate text-sm text-text-3">
                      {s.artist || "Unknown artist"}
                      {s.lastPlayedAt ? `, played ${relativeDate(s.lastPlayedAt)}` : ""}
                    </p>
                  </div>
                  <ButtonLink href={`/studio?song=${s.id}&mode=learn`} size="sm" variant="ghost">
                    Learn
                  </ButtonLink>
                  <ButtonLink href={`/studio?song=${s.id}`} size="sm" icon="play">
                    Play along
                  </ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="text-[15px] text-text-2 font-semibold mb-2">Tools</h2>
          <ul className="flex flex-col gap-1">
            {TOOLS.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="flex gap-3 items-start rounded-lg px-3 py-3 hover:bg-surface transition-colors">
                  <Icon name={t.icon} size={20} className="text-accent mt-0.5 shrink-0" />
                  <span>
                    <span className="block">{t.title}</span>
                    <span className="block text-sm text-text-3">{t.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
