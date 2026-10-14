"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { Button, IconButton, Meter, Pill, Select, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { UseMic } from "@/lib/studio/useMic";
import type { LiveDetection } from "@/lib/coach/chordTracker";
import { chordsCompatible } from "@/lib/music/chords";
import { formatTime } from "@/lib/hooks";

export const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

export function SpeedControl({ speed, onChange, pitchPreserved }: { speed: number; onChange: (s: number) => void; pitchPreserved: boolean }) {
  const isPreset = SPEEDS.some((s) => Math.abs(s - speed) < 0.001);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(String(Math.round(speed * 100)));
  const apply = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 25 && n <= 150) onChange(n / 100);
    else setDraft(String(Math.round(speed * 100)));
  };
  return (
    <div className="flex items-center gap-1.5" title={pitchPreserved ? "Pitch stays the same at slower speeds" : "This browser changes pitch when slowing down"}>
      <label htmlFor="speed" className="text-sm text-text-3">
        Speed
      </label>
      <Select
        id="speed"
        value={custom ? "custom" : String(speed)}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setCustom(true);
            setDraft(String(Math.round(speed * 100)));
          } else {
            setCustom(false);
            onChange(Number(e.target.value));
          }
        }}
        className="h-9"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={String(s)}>
            {Math.round(s * 100)}%
          </option>
        ))}
        <option value="custom">Custom</option>
      </Select>
      {custom && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <input
            aria-label="Custom speed in percent"
            type="number"
            min={25}
            max={150}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={apply}
            className="h-9 w-16 rounded-lg bg-sunk border border-line px-2 text-text tabular focus:border-accent focus:outline-none"
          />
          <span className="text-sm text-text-3">%</span>
        </form>
      )}
    </div>
  );
}

export function MicButton({ mic }: { mic: UseMic }) {
  const on = mic.status === "on";
  const label = {
    off: "Microphone off",
    starting: "Starting microphone…",
    on: "Listening",
    denied: "Microphone blocked",
    "no-device": "No microphone",
    busy: "Microphone busy",
    unsupported: "Microphone not supported",
    error: "Microphone error",
  }[mic.status];
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={on ? "secondary" : "primary"}
        icon={on ? "mic" : "micOff"}
        onClick={() => (on ? mic.stop() : void mic.start())}
        disabled={mic.status === "starting" || mic.status === "unsupported"}
        aria-pressed={on}
        data-testid="mic-toggle"
      >
        {on ? "Listening" : mic.status === "starting" ? "Starting…" : "Listen to me"}
      </Button>
      {on && (
        <div className="w-16" title={`Input level ${Math.round(mic.level)} dB`}>
          <Meter value={(mic.level + 70) / 60} tone={mic.level > -12 ? "warn" : "good"} label="Microphone level" />
        </div>
      )}
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}

export function MicProblem({ mic }: { mic: UseMic }) {
  if (!mic.error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad/35 bg-bad-wash px-3 py-2 text-sm">
      <Icon name="alert" size={16} className="text-bad mt-0.5 shrink-0" />
      <span className="text-text-2">{mic.error}</span>
    </div>
  );
}

/** Describes the live detection against an expected chord, in plain words. */
export function liveVerdict(det: LiveDetection | null, expected: string | null): { text: string; tone: "good" | "bad" | "warn" | "neutral" } {
  if (!det) return { text: "Listening…", tone: "neutral" };
  if (det.state === "silent") return { text: "Waiting for you to play", tone: "neutral" };
  if (det.state === "unclear" || !det.chord) return { text: "Signal unclear · Try strumming more clearly", tone: "warn" };
  if (!expected) return { text: `Detected ${det.chord}`, tone: "neutral" };
  if (det.clarity === "low") return { text: `Expected ${expected} · Detected ${det.chord}? · Not sure yet`, tone: "warn" };
  if (chordsCompatible(expected, det.chord)) return { text: `Expected ${expected} · Detected ${det.chord} · Correct`, tone: "good" };
  return { text: `Expected ${expected} · Detected ${det.chord} · Wrong chord`, tone: "bad" };
}

export function ClarityPill({ det }: { det: LiveDetection | null }) {
  if (!det || det.state !== "chord") return null;
  const tone = det.clarity === "high" ? "good" : det.clarity === "medium" ? "info" : "warn";
  return <Pill tone={tone}>{det.clarity === "high" ? "Clear" : det.clarity === "medium" ? "Fairly clear" : "Unclear"}</Pill>;
}

export const BeatLights = forwardRef<HTMLDivElement, { beatsPerBar: number }>(function BeatLights({ beatsPerBar }, ref) {
  return (
    <div ref={ref} className="flex gap-2" aria-hidden="true">
      {Array.from({ length: beatsPerBar }, (_, i) => (
        <span key={i} data-beat={i} className="h-3 w-3 rounded-full bg-surface-3 transition-colors duration-75 data-[on=true]:bg-accent data-[first=true]:data-[on=true]:bg-chord" data-first={i === 0} />
      ))}
    </div>
  );
});

/** Updates beat lights without re-rendering React. */
export function paintBeat(el: HTMLDivElement | null, beat: number, playing: boolean): void {
  if (!el) return;
  const n = el.children.length;
  const cur = playing && beat >= 0 ? Math.floor(beat) % n : -1;
  const frac = beat - Math.floor(beat);
  for (let i = 0; i < n; i++) (el.children[i] as HTMLElement).dataset.on = String(i === cur && frac < 0.5);
}

export function SeekBar({ time, duration, onSeek, testId = "time" }: { time: number; duration: number; onSeek: (t: number) => void; testId?: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="text-sm tabular text-text-2 w-10 text-right" data-testid={testId}>
        {formatTime(time)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={0.1}
        value={Math.min(time, duration)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek"
        className="flex-1 min-w-[80px]"
      />
      <span className="text-sm tabular text-text-3 w-10">{formatTime(duration)}</span>
    </div>
  );
}

export function TransportButtons({ playing, countingIn, onToggle, onRestart, disabled }: { playing: boolean; countingIn: boolean; onToggle: () => void; onRestart: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={playing ? "Pause" : "Play"}
        data-testid="play-toggle"
        className={cx("h-12 w-12 rounded-full inline-flex items-center justify-center transition-colors", "bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-40")}
      >
        {countingIn ? <span className="chord-face text-lg">…</span> : <Icon name={playing ? "pause" : "play"} size={22} />}
      </button>
      <IconButton icon="restart" label="Back to start" onClick={onRestart} />
    </div>
  );
}

export function RailSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line-soft pt-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm text-text-3">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
