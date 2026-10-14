"use client";

import type { Voicing } from "@/lib/song/model";
import type { Frets } from "@/lib/music/shapes";

/** Fretboard diagram. Strings are listed low E → high E; null = muted. Shows fingers and barres when known. */
export function ChordDiagram({ name, frets, voicing, size = 84, caption = true }: { name: string; frets?: Frets; voicing?: Voicing; size?: number; caption?: boolean }) {
  const v: Voicing = voicing ?? { frets: frets ?? [] };
  const f = v.frets;
  const played = f.filter((x): x is number => x !== null && x > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const maxFret = played.length ? Math.max(...played) : 1;
  const base = maxFret > 4 ? minFret : 1;
  const rows = Math.max(4, maxFret - base + 1);
  const w = 60;
  const h = 70;
  const left = 12;
  const top = 16;
  const sx = w / 5;
  const sy = (h - 10) / rows;
  const label = `${name} chord: ${f.map((x) => (x === null ? "x" : x)).join(" ")}`;
  const barreStrings = new Set<string>();
  for (const b of v.barres ?? []) for (let s = b.fromString; s <= b.toString; s++) barreStrings.add(`${s}:${b.fret}`);
  return (
    <figure className="flex flex-col items-center gap-1" aria-label={label}>
      <svg width={size} height={(size * 96) / 80} viewBox="0 0 80 96" role="img" aria-label={label}>
        {base === 1 ? (
          <rect x={left} y={top - 3} width={w} height={3} fill="var(--text-2)" />
        ) : (
          <text x={left - 3} y={top + sy * 0.7} fontSize="9" textAnchor="end" fill="var(--text-3)">
            {base}
          </text>
        )}
        {Array.from({ length: rows + 1 }, (_, r) => (
          <line key={`f${r}`} x1={left} x2={left + w} y1={top + r * sy} y2={top + r * sy} stroke="var(--line)" strokeWidth="1" />
        ))}
        {Array.from({ length: 6 }, (_, s) => (
          <line key={`s${s}`} x1={left + s * sx} x2={left + s * sx} y1={top} y2={top + rows * sy} stroke="var(--text-3)" strokeWidth="1" />
        ))}
        {(v.barres ?? []).map((b, i) => {
          const row = b.fret - base + 1;
          return <rect key={`b${i}`} x={left + b.fromString * sx - 4.5} y={top + (row - 0.5) * sy - 4.5} width={(b.toString - b.fromString) * sx + 9} height={9} rx={4.5} fill="var(--accent)" />;
        })}
        {f.map((fr, s) => {
          const x = left + s * sx;
          if (fr === null)
            return (
              <text key={s} x={x} y={top - 6} fontSize="9" textAnchor="middle" fill="var(--text-3)">
                ×
              </text>
            );
          if (fr === 0) return <circle key={s} cx={x} cy={top - 8} r="2.6" fill="none" stroke="var(--text-2)" strokeWidth="1.2" />;
          const row = fr - base + 1;
          const cy = top + (row - 0.5) * sy;
          const finger = v.fingers?.[s];
          const onBarre = barreStrings.has(`${s}:${fr}`);
          return (
            <g key={s}>
              {!onBarre && <circle cx={x} cy={cy} r="4.6" fill="var(--accent)" />}
              {finger && !onBarre && (
                <text x={x} y={cy + 2.6} fontSize="7" textAnchor="middle" fill="var(--accent-ink)" fontWeight="700">
                  {finger}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {caption && <figcaption className="chord-face text-chord text-[15px] leading-none">{name}</figcaption>}
    </figure>
  );
}
