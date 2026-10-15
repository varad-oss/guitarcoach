"use client";

import { useMemo } from "react";
import { IconButton, cx } from "@/components/ui";
import { easiestShapes, pitchOffset, shownKey, soundingKey } from "@/lib/music/display";
import type { DisplayPrefs, Song } from "@/lib/song/model";

/**
 * Transpose / capo / simplify / chords toolbar. Changes how the song is shown
 * and practised; the stored chords stay as imported.
 */
export function DisplayControls({ song, prefs, onChange, compact }: { song: Song; prefs: DisplayPrefs; onChange: (p: DisplayPrefs) => void; compact?: boolean }) {
  const capo = prefs.capo ?? song.capo;
  const off = pitchOffset(song, prefs);
  const sk = soundingKey(song, prefs);
  const shapes = shownKey(song, prefs);
  const easiest = useMemo(() => easiestShapes(song), [song]);
  const isEasiest = Boolean(easiest && prefs.simplify && capo === easiest.capo && prefs.transpose === easiest.transpose);
  const easyLabel = easiest ? `${easiest.capo ? `Capo ${easiest.capo}` : "No capo"}: ${easiest.chords.slice(0, 6).join(", ")}${easiest.chords.length > 6 ? "…" : ""}` : "";
  const stepper = (label: string, value: string, dec: () => void, inc: () => void, testId: string) => (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <span className="text-sm text-text-3">{label}</span>
      <IconButton icon="chevronDown" label={`${label} down`} size={30} onClick={dec} />
      <span className="tabular text-sm w-8 text-center" data-testid={testId}>
        {value}
      </span>
      <IconButton icon="chevronDown" label={`${label} up`} size={30} className="rotate-180" onClick={inc} />
    </div>
  );
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2", compact ? "text-sm" : "")}>
      {stepper("Transpose", prefs.transpose > 0 ? `+${prefs.transpose}` : String(prefs.transpose), () => onChange({ ...prefs, transpose: Math.max(-11, prefs.transpose - 1) }), () => onChange({ ...prefs, transpose: Math.min(11, prefs.transpose + 1) }), "transpose-value")}
      {stepper("Capo", capo === 0 ? "none" : String(capo), () => onChange({ ...prefs, capo: Math.max(0, capo - 1) }), () => onChange({ ...prefs, capo: Math.min(12, capo + 1) }), "capo-value")}
      {easiest && (
        <button
          type="button"
          aria-pressed={isEasiest}
          title={isEasiest ? "Showing the easiest shapes. Same sound as the original." : `${easyLabel}. Same sound as the original.`}
          onClick={() => onChange(isEasiest ? { ...prefs, simplify: false, capo: null, transpose: 0 } : { ...prefs, simplify: true, capo: easiest.capo, transpose: easiest.transpose })}
          className={cx(
            "h-8 px-3 rounded-lg text-sm border transition-colors",
            isEasiest ? "bg-accent-wash border-accent-line text-accent" : "border-line text-text-2 hover:text-text hover:bg-surface-2",
          )}
          data-testid="easiest-shapes"
        >
          Easiest shapes
        </button>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={prefs.simplify} onChange={(e) => onChange({ ...prefs, simplify: e.target.checked })} className="accent-[var(--accent)]" />
        Simplify chords
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!prefs.hideChords} onChange={(e) => onChange({ ...prefs, hideChords: !e.target.checked })} className="accent-[var(--accent)]" />
        Chords
      </label>
      {(prefs.transpose !== 0 || prefs.capo !== null || prefs.simplify || prefs.hideChords) && (
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => onChange({ transpose: 0, capo: null, simplify: false, hideChords: false })}>
          Reset
        </button>
      )}
      {isEasiest && easiest && (
        <span className="text-sm text-accent" data-testid="easiest-summary">
          {easyLabel}
          {easiest.openShare === 1 ? " (all open chords)" : ` (${Math.round(easiest.openShare * 100)}% open chords)`}
        </span>
      )}
      {song.key && (
        <span className={cx("text-sm", off === 0 ? "text-text-3" : "text-warn")} data-testid="key-status">
          Shapes in {shapes}, sounds in {sk}
          {off === 0 ? " (original key)" : ` (${off > 0 ? "+" : ""}${off} from the original)`}
        </span>
      )}
    </div>
  );
}
