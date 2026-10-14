/**
 * Live import check against the real site. Opt-in: `npm run test:live`.
 * Asserts structure only — the song's lyrics are never printed or stored.
 */
import { describe, expect, it } from "vitest";
import { importFromUrl } from "./server/importFromUrl";
import { parseSongText } from "../parse";

const LIVE = process.env.LIVE_IMPORT === "1";
const URL_UNDER_TEST = process.env.LIVE_IMPORT_URL ?? "https://tabs.ultimate-guitar.com/tab/ed-sheeran/perfect-chords-1956589";

describe.runIf(LIVE)("live Ultimate Guitar import", () => {
  it(
    "imports and parses the chord sheet",
    async () => {
      const r = await importFromUrl(URL_UNDER_TEST);
      if (!r.ok) throw new Error(`Import failed: ${r.error.code} — ${r.error.message}`);
      const parsed = parseSongText(r.content.text, r.content.format);
      const sections = parsed.sections.filter((s) => s.kind !== "notes");
      const chords = [...new Set(sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.chord))))];
      const summary = {
        title: r.content.title,
        artist: r.content.artist,
        meta: r.content.meta,
        shapes: Object.fromEntries(Object.entries(r.content.shapes ?? {}).map(([k, v]) => [k, 1 + (v.alternates?.length ?? 0)])),
        patterns: (r.content.strumPatterns ?? []).map((p) => `${p.name}: ${p.slots.join("")} (${p.slotsPerBeat}/beat${p.accents ? `, accents ${p.accents.join(",")}` : ""})`),
        source: { ...r.content.sourceMeta, versions: r.content.sourceMeta?.versions?.map((v) => `${v.type} ${v.version}${v.paid ? " (paid)" : ""} ★${v.rating}`) },
        sections: sections.map((s) => `${s.name} (${s.lines.reduce((n, l) => n + l.chords.length, 0)} chords)`),
        uniqueChords: chords,
        chordEvents: parsed.stats.chordEvents,
        flaggedLines: parsed.stats.flaggedLines,
        confidence: parsed.confidence,
        sheetShapes: Object.keys(parsed.chordShapes),
      };
      console.log(JSON.stringify(summary, null, 2));
      expect(r.content.title).toBeTruthy();
      expect(parsed.stats.chordEvents).toBeGreaterThan(20);
      expect(sections.length).toBeGreaterThan(3);
      expect(r.content.strumPatterns?.length).toBeGreaterThan(0);
      expect(Object.keys(r.content.shapes ?? {}).length).toBeGreaterThan(3);
    },
    30_000,
  );
});
