import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addNoise, encodeWav, midiToHz, normalise, pluck, rng, strum } from "../src/lib/dsp/synth";
import { shapeForChord } from "../src/lib/music/shapes";

/** Generates synthetic audio fixtures (fake microphone input and an uploadable recording). */
export default function globalSetup() {
  const dir = path.resolve(__dirname, ".fixtures");
  mkdirSync(dir, { recursive: true });
  const SR = 48000;

  // A G chord strummed every 0.6 s for 20 s (Chromium loops this as the microphone).
  const g = new Float32Array(SR * 20);
  for (let t = 0.2, i = 0; t < 19.5; t += 0.6, i++) strum(g, SR, t, shapeForChord("G")!, { seed: i + 1, direction: i % 2 ? "up" : "down", maxSec: 1.2 });
  addNoise(g, 0.002);
  normalise(g, 0.7);
  writeFileSync(path.join(dir, "g-strums.wav"), encodeWav(g, SR));

  // A2 string plucked every 2 s, for the tuner.
  const a = new Float32Array(SR * 12);
  for (let t = 0.1, i = 0; t < 11; t += 2, i++) pluck(a, SR, Math.round(t * SR), midiToHz(45), { random: rng(i + 3), amp: 0.5, maxSec: 2 });
  normalise(a, 0.7);
  writeFileSync(path.join(dir, "a-string.wav"), encodeWav(a, SR));

  // A 100 BPM recording of G Em C D (one bar each), at 22.05 kHz to keep it small.
  const sr2 = 22050;
  const spb = 0.6;
  const prog = ["G", "Em", "C", "D"];
  const rec = new Float32Array(Math.ceil(sr2 * (0.5 + 16 * 4 * spb + 1.5)));
  for (let bar = 0; bar < 16; bar++)
    for (let beat = 0; beat < 4; beat++)
      strum(rec, sr2, 0.5 + (bar * 4 + beat) * spb, shapeForChord(prog[bar % 4])!, { seed: bar * 4 + beat + 1, amp: beat === 0 ? 0.32 : 0.2, maxSec: 1.2 });
  addNoise(rec, 0.002);
  normalise(rec, 0.8);
  writeFileSync(path.join(dir, "progression-100bpm.wav"), encodeWav(rec, sr2));
}
