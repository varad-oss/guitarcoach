/**
 * Chord-judging accuracy on GuitarSet (real acoustic guitar, real microphone).
 * Opt-in: download the dataset (see README) and run `npm run eval:guitarset`.
 *
 * Every accompaniment ("comp") recording is fed through the same steps the
 * live app uses: 8192-point frames every 2048 samples → chroma → the per-chord
 * verdicts of `evaluateChords`. Each annotated chord is judged twice:
 *  - expecting the chord that was really played (should be "correct", never "wrong");
 *  - expecting a different chord from the same song (should be "wrong").
 * Then again with personal calibration: two takes per chord taken from the same
 * player's OTHER chord progressions, never the recording under test.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { magnitudeSpectrum, rms, toDb } from "./fft";
import { chromaFromSpectrum, isTonal } from "./chroma";
import { rankChords, setPersonalProfile } from "./chordTemplates";
import { buildProfile, type CalibrationTake } from "./calibration";
import { evaluateChords, type ExpectedEvent, type SongFrame } from "../coach/evaluate";
import { SILENCE_DB } from "../coach/chordTracker";
import { chordsCompatible, chordsOverlap, parseChord, transposeChord } from "../music/chords";

const RUN = process.env.GUITARSET === "1";
const ROOT = process.env.GUITARSET_DIR ?? path.resolve(import.meta.dirname, "../../../datasets/guitarset");

// ---------- loading ----------

function readWav(file: string): { samples: Float32Array; sr: number } {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt = { format: 1, channels: 1, sr: 44100, bits: 16 };
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
      if (fmt.format === 0xfffe) fmt.format = b.readUInt16LE(body + 24);
    } else if (id === "data") {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, b.length - body) / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let ch = 0; ch < fmt.channels; ch++) {
          const p = body + (i * fmt.channels + ch) * bytes;
          if (fmt.format === 3) s += bytes === 4 ? b.readFloatLE(p) : b.readDoubleLE(p);
          else if (bytes === 2) s += b.readInt16LE(p) / 32768;
          else if (bytes === 3) s += b.readIntLE(p, 3) / 8388608;
          else if (bytes === 4) s += b.readInt32LE(p) / 2147483648;
        }
        out[i] = s / fmt.channels;
      }
      return { samples: out, sr: fmt.sr };
    }
    off = body + size + (size % 2);
  }
  throw new Error(`No audio data in ${file}`);
}

const HARTE: Record<string, string> = {
  maj: "", min: "m", "7": "7", maj7: "maj7", min7: "m7", hdim7: "m7b5", dim: "dim", dim7: "dim7",
  aug: "aug", sus2: "sus2", sus4: "sus4", "5": "5", maj6: "6", min6: "m6", "9": "9", min9: "m9", maj9: "maj9",
};

/** "C#:min7/b3" → "C#m7"; null for no-chord or qualities the app doesn't spell. */
export function harteToSymbol(label: string): string | null {
  if (label === "N" || label === "X") return null;
  const [rootPart, rest = "maj"] = label.split(":");
  const quality = rest.split("/")[0].split("(")[0] || "maj";
  const suffix = HARTE[quality];
  if (suffix === undefined) return null;
  const sym = rootPart + suffix;
  return parseChord(sym) ? sym : null;
}

interface Segment { start: number; end: number; chord: string }
interface Recording { id: string; player: string; style: string; progression: string; frames: SongFrame[]; segments: Segment[] }

function loadAnnotation(file: string): Segment[] {
  const jams = JSON.parse(fs.readFileSync(file, "utf8"));
  // GuitarSet has two chord annotations: the chords the player was asked to
  // play (lead sheet) and the chords inferred from what was played. Use the latter.
  const chordAnns = jams.annotations.filter((a: { namespace: string }) => a.namespace === "chord");
  const ann = chordAnns[1] ?? chordAnns[0];
  return ann.data
    .map((d: { time: number; duration: number; value: string }) => ({ start: d.time, end: d.time + d.duration, chord: harteToSymbol(d.value) }))
    .filter((s: { chord: string | null }) => s.chord !== null) as Segment[];
}

/** Mirrors analysis.worker.ts: N-point frames every N/4 samples, time = frame centre. */
function analyse(samples: Float32Array, sr: number): SongFrame[] {
  const N = sr >= 32000 ? 8192 : 4096;
  const HOP = N / 4;
  const out: SongFrame[] = [];
  for (let end = N; end <= samples.length; end += HOP) {
    const ring = samples.subarray(end - N, end);
    const c = chromaFromSpectrum(magnitudeSpectrum(ring, N), { sampleRate: sr, fftSize: N });
    const t = end / sr - N / sr / 2;
    out.push({ time: t, songTime: t, rmsDb: toDb(rms(ring.subarray(N - HOP))), tonal: isTonal(c), chroma: Array.from(c.chroma), bassPc: c.bassPc });
  }
  return out;
}

function loadAll(): Recording[] {
  const audioDir = findDir(path.join(ROOT, "audio"));
  const annDir = findDir(path.join(ROOT, "annotation"));
  const wavs = fs.readdirSync(audioDir).filter((f) => /_comp_mic\.wav$/.test(f)).sort();
  const limit = Number(process.env.GUITARSET_LIMIT ?? Infinity);
  return wavs.slice(0, limit).map((w) => {
    const id = w.replace(/_mic\.wav$/, "");
    const { samples, sr } = readWav(path.join(audioDir, w));
    const progression = id.split("_")[1].split("-")[0];
    return { id, player: id.slice(0, 2), style: progression.replace(/\d+$/, ""), progression, frames: analyse(samples, sr), segments: loadAnnotation(path.join(annDir, `${id}.jams`)) };
  });
}

function findDir(dir: string): string {
  // Zips may unpack into a nested folder.
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && /\.(wav|jams)$/.test(e.name))) return dir;
  const sub = entries.find((e) => e.isDirectory() && !e.name.startsWith("__"));
  if (!sub) throw new Error(`No GuitarSet files under ${dir}`);
  return findDir(path.join(dir, sub.name));
}

// ---------- evaluation ----------

type Verdict = "correct" | "wrong" | "uncertain" | "missed" | "not-evaluated";
type Tally = Record<Verdict, number>;
const emptyTally = (): Tally => ({ correct: 0, wrong: 0, uncertain: 0, missed: 0, "not-evaluated": 0 });

function events(segs: Segment[], chordOf: (s: Segment, i: number) => string): ExpectedEvent[] {
  return segs.map((s, i) => ({ key: String(i), index: i, chord: chordOf(s, i), sectionName: "", sectionIndex: 0, lineIndex: 0, start: s.start, end: s.end }));
}

const distinct = (a: string, b: string) => !chordsCompatible(a, b) && !chordsCompatible(b, a) && !chordsOverlap(a, b) && !chordsOverlap(b, a);

/** A clearly different chord from the same song (the nearest one that isn't a rendition of this one). */
function wrongChordFor(segs: Segment[], i: number): string {
  for (let d = 1; d < segs.length; d++) {
    for (const j of [i + d, i - d]) {
      if (j >= 0 && j < segs.length && distinct(segs[i].chord, segs[j].chord)) return segs[j].chord;
    }
  }
  return transposeChord(segs[i].chord, 5);
}

function judge(rec: Recording, wrong: boolean): Tally {
  const t = emptyTally();
  const evs = events(rec.segments, (s, i) => (wrong ? wrongChordFor(rec.segments, i) : s.chord));
  for (const r of evaluateChords(evs, rec.frames, [], { capo: 0, onTimeMs: 60, windowMs: 250, msTiming: false })) t[r.verdict as Verdict]++;
  return t;
}

function top1(rec: Recording): { hit: number; n: number } {
  let hit = 0;
  let n = 0;
  for (const s of rec.segments) {
    for (const f of rec.frames) {
      if (f.songTime < s.start + 0.12 || f.songTime >= s.end || !f.tonal || f.rmsDb <= SILENCE_DB) continue;
      n++;
      if (chordsCompatible(s.chord, rankChords(f.chroma, f.bassPc)[0].symbol)) hit++;
    }
  }
  return { hit, n };
}

/** Up to `perChord` takes of each chord from the player's other progressions. */
function calibrationTakes(all: Recording[], held: Recording, perChord: number): CalibrationTake[] {
  const takes: CalibrationTake[] = [];
  const count = new Map<string, number>();
  for (const rec of all) {
    if (rec.player !== held.player || rec.progression === held.progression) continue;
    rec.segments.forEach((s, i) => {
      if (s.end - s.start < 1 || (count.get(s.chord) ?? 0) >= perChord) return;
      const frames = rec.frames
        .filter((f) => f.songTime >= s.start + 0.12 && f.songTime < Math.min(s.end, s.start + 2.5) && f.tonal && f.rmsDb > SILENCE_DB)
        .map((f) => ({ chroma: Array.from(f.chroma), bassPc: f.bassPc }));
      if (frames.length < 6) return;
      takes.push({ id: `${rec.id}#${i}`, chord: s.chord, frames, createdAt: "" });
      count.set(s.chord, (count.get(s.chord) ?? 0) + 1);
    });
  }
  return takes;
}

const add = (a: Tally, b: Tally) => (Object.keys(a) as Verdict[]).forEach((k) => (a[k] += b[k]));
const pct = (x: number, n: number) => `${((100 * x) / Math.max(1, n)).toFixed(1)}%`;

function describeTally(t: Tally) {
  const judged = t.correct + t.wrong + t.uncertain;
  return { judged, correct: pct(t.correct, judged), wrong: pct(t.wrong, judged), uncertain: pct(t.uncertain, judged), notJudged: t.missed + t["not-evaluated"] };
}

describe.runIf(RUN)("GuitarSet chord judging", () => {
  it(
    "reports accuracy with built-in templates and with personal calibration",
    () => {
      const recs = loadAll();
      expect(recs.length).toBeGreaterThan(0);
      const rows: Record<string, { right: Tally; wrongExp: Tally; top: { hit: number; n: number } }> = {};
      const modes = ["built-in", "calibrated"] as const;
      const perPlayer: Record<string, Record<string, { right: Tally; wrongExp: Tally }>> = {};
      const perStyle: Record<string, Record<string, { right: Tally; wrongExp: Tally }>> = {};
      for (const mode of modes) {
        const right = emptyTally();
        const wrongExp = emptyTally();
        const top = { hit: 0, n: 0 };
        for (const rec of recs) {
          setPersonalProfile(mode === "calibrated" ? buildProfile(calibrationTakes(recs, rec, 2)) : null);
          const r = judge(rec, false);
          const w = judge(rec, true);
          const t1 = top1(rec);
          add(right, r);
          add(wrongExp, w);
          top.hit += t1.hit;
          top.n += t1.n;
          for (const p of [((perPlayer[rec.player] ??= {})[mode] ??= { right: emptyTally(), wrongExp: emptyTally() }), ((perStyle[rec.style] ??= {})[mode] ??= { right: emptyTally(), wrongExp: emptyTally() })]) {
            add(p.right, r);
            add(p.wrongExp, w);
          }
        }
        rows[mode] = { right, wrongExp, top };
      }
      setPersonalProfile(null);

      const summary = {
        dataset: "GuitarSet comp recordings, mono mic (CC BY 4.0)",
        recordings: recs.length,
        chordEvents: recs.reduce((n, r) => n + r.segments.length, 0),
        results: Object.fromEntries(
          modes.map((m) => [
            m,
            {
              playedTheRightChord: describeTally(rows[m].right),
              playedAWrongChord: describeTally(rows[m].wrongExp),
              frameTop1: pct(rows[m].top.hit, rows[m].top.n),
            },
          ]),
        ),
        perStyle: breakdown(perStyle),
        perPlayer: breakdown(perPlayer),
      };
      function breakdown(groups: typeof perPlayer) {
        return Object.fromEntries(
          Object.entries(groups).map(([p, byMode]) => [
            p,
            Object.fromEntries(modes.map((m) => [m, { rightChordFlaggedWrong: describeTally(byMode[m].right).wrong, wrongChordCaught: describeTally(byMode[m].wrongExp).wrong }])),
          ]),
        );
      }
      fs.writeFileSync(path.join(ROOT, "results.json"), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
    },
    60 * 60 * 1000,
  );
});
