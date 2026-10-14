"use client";

import { useState, type ReactNode } from "react";
import type { ChordResult } from "@/lib/coach/types";

/** Small hover/focus tooltip shared by the charts. */
function Tip({ left, top, children }: { left: string; top: string; children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface-3 px-2 py-1 text-xs text-text whitespace-nowrap shadow-lg"
      style={{ left, top: `calc(${top} - 8px)` }}
    >
      {children}
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  tip: string;
}

/** Single-series column chart (e.g. minutes practised per day). */
export function ColumnChart({ data, height = 140, unit, title }: { data: BarDatum[]; height?: number; unit: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 480;
  const padL = 34;
  const padB = 22;
  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = max <= 2 ? 2 : Math.ceil(max / 5) * 5;
  const band = (w - padL) / data.length;
  const bw = Math.min(24, band - 4);
  const y = (v: number) => (height - padB) * (1 - v / niceMax) + 4;
  const maxIdx = data.reduce((bi, d, i) => (d.value > data[bi].value ? i : bi), 0);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" role="img" aria-label={title}>
        {[0, niceMax / 2, niceMax].map((v) => (
          <g key={v}>
            <line x1={padL} x2={w} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--text-3)">
              {v}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, h);
          const x0 = cx - bw / 2;
          const top = y(d.value);
          const path = h > 0 ? `M${x0},${y(0)} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${y(0)} Z` : "";
          return (
            <g key={i}>
              {path && <path d={path} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.55} />}
              <rect
                x={padL + band * i}
                y={0}
                width={band}
                height={height - padB + 4}
                fill="transparent"
                tabIndex={0}
                aria-label={d.tip}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {(i === maxIdx || i === data.length - 1) && d.value > 0 && (
                <text x={cx} y={top - 5} fontSize={11} textAnchor="middle" fill="var(--text-2)">
                  {d.value < 10 ? d.value.toFixed(1) : Math.round(d.value)}
                </text>
              )}
              {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && (
                <text x={cx} y={height - 5} fontSize={11} textAnchor="middle" fill="var(--text-3)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tip left={`${((padL + band * hover + band / 2) / w) * 100}%`} top="0%">
          {data[hover].tip}
        </Tip>
      )}
      <details className="mt-1 text-sm text-text-3">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 text-text-2">
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td className="pr-6">{d.label}</td>
                <td className="tabular text-right">
                  {d.value < 10 ? d.value.toFixed(1) : Math.round(d.value)} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export interface DotDatum {
  x: number;
  y: number;
  tip: string;
}

/** Single-series dot plot over time with a 0–100% y axis. */
export function PercentDots({ data, title, height = 150 }: { data: DotDatum[]; title: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 480;
  const padL = 40;
  const padR = 10;
  const padB = 10;
  if (data.length === 0) return null;
  const x0 = Math.min(...data.map((d) => d.x));
  const x1 = Math.max(...data.map((d) => d.x));
  const x = (v: number) => padL + (x1 === x0 ? (w - padL - padR) / 2 : ((v - x0) / (x1 - x0)) * (w - padL - padR));
  const y = (v: number) => 8 + (height - padB - 8) * (1 - v);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" role="img" aria-label={title}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--text-3)">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        {data.length > 1 && (
          <polyline points={data.map((d) => `${x(d.x)},${y(d.y)}`).join(" ")} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={2} strokeLinejoin="round" />
        )}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(d.x)} cy={y(d.y)} r={hover === i ? 6 : 4.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
            <circle
              cx={x(d.x)}
              cy={y(d.y)}
              r={12}
              fill="transparent"
              tabIndex={0}
              aria-label={d.tip}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tip left={`${(x(data[hover].x) / w) * 100}%`} top={`${(y(data[hover].y) / height) * 100}%`}>
          {data[hover].tip}
        </Tip>
      )}
    </div>
  );
}

/**
 * One mark per checked chord, in playing order. Correct chords rise above the
 * baseline, problems drop below it, unclear results are hollow on the line,
 * so position (not only colour) carries the meaning.
 */
export function ResultStrip({ results }: { results: ChordResult[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = results.length;
  if (n === 0) return null;
  const w = 640;
  const h = 70;
  const mid = 35;
  const step = (w - 8) / n;
  const bw = Math.max(2, Math.min(10, step - 2));
  const describe = (r: ChordResult) =>
    `${r.sectionName || "Song"}: ${r.expected} — ${
      r.verdict === "correct" ? "correct" : r.verdict === "wrong" ? `heard ${r.detected}` : r.verdict === "missed" ? "missed" : "couldn't tell"
    }${r.offsetMs !== undefined ? `, ${Math.abs(r.offsetMs)} ms ${r.offsetMs < 0 ? "early" : "late"}` : ""}`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label={`${n} chords in playing order: correct above the line, problems below`}>
        <line x1={0} x2={w} y1={mid} y2={mid} stroke="var(--line)" strokeWidth={1} />
        {results.map((r, i) => {
          const cx = 4 + step * i + step / 2;
          const x0 = cx - bw / 2;
          const common = {
            onMouseEnter: () => setHover(i),
            onMouseLeave: () => setHover(null),
          };
          if (r.verdict === "correct") return <rect key={i} x={x0} y={mid - 26} width={bw} height={24} rx={Math.min(2, bw / 2)} fill="var(--accent)" {...common} />;
          if (r.verdict === "wrong" || r.verdict === "missed")
            return <rect key={i} x={x0} y={mid + 2} width={bw} height={r.verdict === "missed" ? 14 : 24} rx={Math.min(2, bw / 2)} fill="var(--bad)" {...common} />;
          return <circle key={i} cx={cx} cy={mid} r={Math.max(2.5, Math.min(4, bw / 2))} fill="var(--bg)" stroke="var(--text-3)" strokeWidth={1.5} {...common} />;
        })}
      </svg>
      {hover !== null && (
        <Tip left={`${((4 + step * hover + step / 2) / w) * 100}%`} top="0%">
          {describe(results[hover])}
        </Tip>
      )}
      <div className="flex flex-wrap gap-4 text-xs text-text-3 mt-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-3 rounded-sm bg-accent" /> Correct (above the line)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-3 rounded-sm bg-bad" /> Wrong or missed (below)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full border-[1.5px] border-text-3" /> Couldn&apos;t tell (on the line)
        </span>
      </div>
    </div>
  );
}
