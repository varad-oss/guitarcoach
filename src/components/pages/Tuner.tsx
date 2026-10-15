"use client";

import { useEffect, useRef, useState } from "react";
import { Button, PageHeader, Pill, Segmented, cx } from "@/components/ui";
import { MicButton, MicProblem } from "@/components/studio/parts";
import { useMic } from "@/lib/studio/useMic";
import { useSettings } from "@/lib/hooks";
import { STANDARD_TUNING, freqToMidi, midiName, nearestString, type TuningString } from "@/lib/dsp/pitch";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function Tuner() {
  const [settings] = useSettings();
  const mic = useMic({ mode: "tuner", a4: settings.a4, deviceId: settings.micDeviceId, latencyMs: settings.latencyMs });
  const [target, setTarget] = useState<"auto" | number>("auto");
  const recent = useRef<number[]>([]);
  const [shown, setShown] = useState<{ freq: number; confidence: number } | null>(null);
  const lastHeard = useRef(0);

  const p = mic.pitch;
  useEffect(() => {
    if (!p) return;
    if (p.freq && p.confidence >= 0.8 && p.rmsDb > -55) {
      recent.current = [...recent.current.slice(-4), p.freq];
      lastHeard.current = performance.now();
      const f = median(recent.current);
      const conf = p.confidence;
      queueMicrotask(() => setShown({ freq: f, confidence: conf }));
    } else if (performance.now() - lastHeard.current > 1200) {
      recent.current = [];
      queueMicrotask(() => setShown(null));
    }
  }, [p]);

  let str: TuningString | null = null;
  let cents = 0;
  if (shown) {
    if (target === "auto") {
      const n = nearestString(shown.freq, STANDARD_TUNING, settings.a4);
      str = n.string;
      cents = n.cents;
    } else {
      str = STANDARD_TUNING[target];
      cents = (freqToMidi(shown.freq, settings.a4) - str.midi) * 100;
    }
  }
  const inTune = shown && Math.abs(cents) <= 5;
  const farOff = shown && Math.abs(cents) > 100;
  const needle = Math.max(-50, Math.min(50, cents));

  return (
    <div className="px-4 md:px-10 py-8 mx-auto w-full max-w-[860px] flex flex-col gap-6">
      <PageHeader title="Tuner" description={`Standard tuning (E A D G B E), A4 = ${settings.a4} Hz. Play one string at a time.`} actions={<MicButton mic={mic} />} />
      <MicProblem mic={mic} />
      <Segmented
        label="String"
        value={String(target)}
        onChange={(v) => setTarget(v === "auto" ? "auto" : Number(v))}
        options={[{ value: "auto", label: "Auto" }, ...STANDARD_TUNING.map((s, i) => ({ value: String(i), label: s.name.replace(/\d/, "") + (i === 0 ? " (low)" : i === 5 ? " (high)" : "") }))]}
      />
      <section className="rounded-2xl border border-line-soft bg-sunk p-8 flex flex-col items-center gap-4" aria-live="polite" data-testid="tuner-display">
        <div className="flex items-end gap-6">
          <div className="text-center">
            <p className="text-sm text-text-3">Heard</p>
            <p className={cx("chord-face text-[88px] leading-none", inTune ? "text-accent" : "text-chord")} data-testid="tuner-note">
              {shown ? midiName(freqToMidi(shown.freq, settings.a4)).replace(/\d+$/, "") : "–"}
            </p>
          </div>
          <div className="text-center pb-2">
            <p className="text-sm text-text-3">Target</p>
            <p className="chord-face text-4xl text-text-2">{str ? str.name : "–"}</p>
          </div>
        </div>
        <svg viewBox="0 0 400 90" className="w-full max-w-[520px]" role="img" aria-label={shown ? `${Math.round(cents)} cents ${cents < 0 ? "flat" : "sharp"}` : "No pitch"}>
          {Array.from({ length: 11 }, (_, i) => {
            const x = 20 + i * 36;
            return <line key={i} x1={x} x2={x} y1={i === 5 ? 18 : 28} y2={62} stroke={i === 5 ? "var(--accent)" : "var(--line)"} strokeWidth={i === 5 ? 2.5 : 1.5} />;
          })}
          <rect x={200 - 18} y={14} width={36} height={52} rx={6} fill="var(--accent-wash)" />
          {shown && !farOff && <line x1={200 + needle * 3.6} x2={200 + needle * 3.6} y1={8} y2={72} stroke={inTune ? "var(--accent)" : "var(--warn)"} strokeWidth={4} strokeLinecap="round" />}
          <text x={20} y={86} fontSize={12} fill="var(--text-3)" textAnchor="middle">
            −50
          </text>
          <text x={200} y={86} fontSize={12} fill="var(--text-3)" textAnchor="middle">
            0
          </text>
          <text x={380} y={86} fontSize={12} fill="var(--text-3)" textAnchor="middle">
            +50
          </text>
        </svg>
        <p className="text-lg" data-testid="tuner-cents">
          {!shown
            ? mic.status === "on"
              ? "Play a single string"
              : "Turn on listening to tune"
            : farOff
              ? "More than a semitone away from that string"
              : inTune
                ? "In tune"
                : `${Math.abs(Math.round(cents))} cents ${cents < 0 ? "flat — tighten" : "sharp — loosen"}`}
        </p>
        <div className="flex gap-3 items-center text-sm text-text-3">
          <span className="tabular">{shown ? `${shown.freq.toFixed(1)} Hz` : "— Hz"}</span>
          {shown && <Pill tone={shown.confidence > 0.92 ? "good" : "info"}>{shown.confidence > 0.92 ? "Clear pitch" : "Some noise"}</Pill>}
        </div>
      </section>
      <p className="text-sm text-text-3">
        The tuner uses the YIN pitch method on this device. Pluck one string and let it ring; strumming several strings at once can&apos;t be tuned. The microphone
        is released when you leave this page.
      </p>
      {mic.status === "on" && (
        <div>
          <Button variant="ghost" onClick={mic.stop}>
            Stop listening
          </Button>
        </div>
      )}
    </div>
  );
}
