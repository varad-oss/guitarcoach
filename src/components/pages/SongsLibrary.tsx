"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ButtonLink, ConfirmDialog, IconButton, Input, PageHeader, Pill, Select, Spinner, Notice, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { deleteSong, listSongs, updateSong } from "@/lib/db/db";
import { relativeDate, useLiveQuery } from "@/lib/hooks";
import { chordEventCount, uniqueChords, type Song } from "@/lib/song/model";

type Sort = "played" | "added" | "title" | "artist";
type Filter = "all" | "favorites" | "audio" | "review";

function needsReview(s: Song): boolean {
  return (s.parse?.confidence ?? 1) < 0.85 || s.sections.some((x) => x.lines.some((l) => l.flag));
}

export function SongsLibrary() {
  const songs = useLiveQuery(listSongs, []);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("played");
  const [filter, setFilter] = useState<Filter>("all");
  const [toDelete, setToDelete] = useState<Song | null>(null);

  const list = useMemo(() => {
    if (songs.status !== "ready") return [];
    const needle = q.trim().toLowerCase();
    let out = songs.data.filter((s) => !needle || s.title.toLowerCase().includes(needle) || s.artist.toLowerCase().includes(needle));
    if (filter === "favorites") out = out.filter((s) => s.favorite);
    if (filter === "audio") out = out.filter((s) => !!s.activeRecordingId);
    if (filter === "review") out = out.filter(needsReview);
    const by: Record<Sort, (a: Song, b: Song) => number> = {
      played: (a, b) => (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt),
      added: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title),
      artist: (a, b) => (a.artist || "~").localeCompare(b.artist || "~") || a.title.localeCompare(b.title),
    };
    return out.sort(by[sort]);
  }, [songs, q, sort, filter]);

  if (songs.status === "loading") return <div className="p-8"><Spinner /></div>;
  if (songs.status === "error") return <div className="p-8"><Notice tone="bad">{songs.error}</Notice></div>;
  const total = songs.data.length;

  return (
    <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="My Songs"
        description={total ? `${total} song${total === 1 ? "" : "s"} saved on this device.` : undefined}
        actions={
          <ButtonLink href="/add" variant="primary" icon="plus">
            Add song
          </ButtonLink>
        }
      />
      {total === 0 ? (
        <div className="rounded-xl border border-line-soft px-6 py-12 text-center flex flex-col items-center gap-3">
          <Icon name="library" size={28} className="text-text-3" />
          <p className="text-lg">Your library is empty</p>
          <p className="text-text-2 max-w-[44ch]">Songs you import or create appear here, ready to practise.</p>
          <ButtonLink href="/add" variant="primary" icon="plus">
            Add your first song
          </ButtonLink>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Icon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <Input aria-label="Search by title or artist" placeholder="Search by title or artist" className="w-full pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All songs</option>
              <option value="favorites">Favorites</option>
              <option value="audio">With a recording</option>
              <option value="review">Needs review</option>
            </Select>
            <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="played">Recently played</option>
              <option value="added">Recently added</option>
              <option value="title">Title</option>
              <option value="artist">Artist</option>
            </Select>
          </div>
          {list.length === 0 ? (
            <p className="text-text-3 py-8">No songs match.</p>
          ) : (
            <ul className="divide-y divide-line-soft border-y border-line-soft" aria-label="Songs">
              {list.map((s) => {
                const chords = uniqueChords(s);
                return (
                  <li key={s.id} className="flex items-center gap-2 py-2 pl-1 pr-1 hover:bg-surface/60">
                    <IconButton
                      icon="star"
                      label={s.favorite ? `Remove ${s.title} from favorites` : `Add ${s.title} to favorites`}
                      active={s.favorite}
                      size={36}
                      onClick={() => updateSong(s.id, (x) => ({ ...x, favorite: !x.favorite }), { userEdit: false })}
                    />
                    <Link href={`/song?id=${s.id}`} className="min-w-0 flex-1 py-1">
                      <p className="truncate">{s.title}</p>
                      <p className="truncate text-sm text-text-3">
                        {[s.artist || "Unknown artist", chords.slice(0, 6).join(" "), s.lastPlayedAt ? `played ${relativeDate(s.lastPlayedAt)}` : null]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </Link>
                    <div className="hidden sm:flex gap-1.5 items-center">
                      {s.activeRecordingId && <Pill>Recording</Pill>}
                      {needsReview(s) && <Pill tone="warn">Check</Pill>}
                      {chordEventCount(s) === 0 && <Pill tone="info">No chords</Pill>}
                    </div>
                    <ButtonLink href={`/studio?song=${s.id}`} size="sm" icon="play" className={cx("ml-1")} aria-label={`Practise ${s.title}`}>
                      Practise
                    </ButtonLink>
                    <IconButton icon="trash" label={`Delete ${s.title}`} size={36} onClick={() => setToDelete(s)} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={`Delete “${toDelete?.title}”?`}
        body={
          <p>
            The song and its recordings are removed from this device. Your practice history is kept. This can&apos;t be undone unless you have a backup.
          </p>
        }
        confirmLabel="Delete song"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteSong(toDelete.id)}
      />
    </div>
  );
}
