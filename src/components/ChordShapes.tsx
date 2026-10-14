"use client";

import { useState } from "react";
import { ChordDiagram } from "./ChordDiagram";
import { IconButton } from "./ui";
import { updateSong } from "@/lib/db/db";
import { shapeForChord } from "@/lib/music/shapes";
import type { Song, Voicing } from "@/lib/song/model";

function voicingsFor(song: Song, chord: string): Voicing[] {
  const s = song.chordShapes[chord];
  if (s) return [s, ...(s.alternates ?? [])];
  const lib = shapeForChord(chord);
  return lib ? [{ frets: lib }] : [];
}

/** Chord diagrams for a song, with a switcher through the alternate voicings. */
export function ChordShapes({ song, chords, persistSongId, size = 68 }: { song: Song; chords: string[]; persistSongId?: string; size?: number }) {
  const [index, setIndex] = useState<Record<string, number>>({});
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-3">
      {chords.slice(0, 24).map((c) => {
        const all = voicingsFor(song, c);
        if (!all.length) return <div key={c} className="chord-face text-chord text-center self-end">{c}</div>;
        const i = Math.min(index[c] ?? 0, all.length - 1);
        const choose = (n: number) => setIndex((x) => ({ ...x, [c]: (n + all.length) % all.length }));
        return (
          <div key={c} className="flex flex-col items-center">
            <ChordDiagram name={c} voicing={all[i]} size={size} />
            {all.length > 1 && (
              <div className="flex items-center gap-0.5 text-xs text-text-3">
                <IconButton icon="chevronLeft" label={`Previous ${c} voicing`} size={24} onClick={() => choose(i - 1)} />
                <span className="tabular">
                  {i + 1}/{all.length}
                </span>
                <IconButton icon="chevronRight" label={`Next ${c} voicing`} size={24} onClick={() => choose(i + 1)} />
              </div>
            )}
            {persistSongId && i > 0 && (
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={async () => {
                  const chosen = all[i];
                  await updateSong(
                    persistSongId,
                    (s) => ({
                      ...s,
                      chordShapes: {
                        ...s.chordShapes,
                        [c]: { ...chosen, source: s.chordShapes[c]?.source ?? "user", alternates: all.filter((_, k) => k !== i) },
                      },
                    }),
                    { userEdit: false },
                  );
                  setIndex((x) => ({ ...x, [c]: 0 }));
                }}
              >
                Use this one
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
