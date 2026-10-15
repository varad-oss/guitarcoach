# Testing and accuracy

[← Back to the README](../README.md)

## Commands

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests (Vitest): parsing, import/SSRF, timeline and alignment, DSP, coaching, persistence, backup |
| `npm run test:e2e` | Browser tests (Playwright, Chromium) against `next start` on port 3100. Run `npm run build` first. |
| `npm run test:live` | Opt-in live import of the real Ultimate Guitar page used during development (network required) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run test:all` | All of the above except the live test |
| `npm run eval:guitarset` | Chord-judging accuracy on the GuitarSet recordings (dataset download needed, see below) |
| `npm run screenshots` | Regenerates the README screenshots in `docs/screenshots/` (after `npm run build`) |

First time only, Playwright needs its browser: `npx playwright install chromium`.

## What was tested, and how

- **Unit tests (`npm test`).** Chord parsing, sheet/ChordPro parsing and round trips, URL validation, SSRF guards, redirects, size limits and error mapping, the UG extractor (on synthetic fixtures), timeline and alignment maths, tap fitting, tempo estimation, chord recognition, onset timing, the tuner, full-recording analysis, per-chord evaluation, strum matching, latency calibration, IndexedDB persistence, migration, and backup/restore.
- **Live import (`npm run test:live`).** Imports `https://tabs.ultimate-guitar.com/tab/ed-sheeran/perfect-chords-1956589` through the real adapter and parser, and asserts structure only (no lyrics are printed or stored by the test). Results: title and artist read, capo 1, key Ab, 64 BPM, 10 song sections, 111 chord events, 0 flagged lines, all 6 chord shapes defined in the sheet's header, 3 strumming patterns, 13 voicings for each of the 7 chords, rating/difficulty/author/views, and 6 free other versions (the Official version is listed as paid).
- **YouTube.** Checked by hand once with a real video in the browser (player loads, studio follows its clock, pause works). The automated browser test uses a local stand-in for YouTube's player script.
- **Browser tests (`npm run test:e2e`).** Navigation, empty states, paste → edit → save → reload, link-import failure paths, duplicate handling, PDF import, image OCR, audio-only import, the bookmarklet handoff, backup/restore, autoscroll, loop and speed, recording upload and analysis, timing alignment, offline reload via the service worker, mic permission denial, free-play detection, the rhythm drill, the tuner, mic release on navigation, and a full practice session through to its report.

- **Real-guitar evaluation (`npm run eval:guitarset`).** Uses [GuitarSet](https://zenodo.org/records/3371780) (CC BY 4.0): 180 accompaniment recordings by 6 players on an acoustic guitar, recorded with a microphone, with hand-checked chord annotations. Each recording goes through the same steps as the live microphone (frames, chroma, per-chord verdicts). Every annotated chord is judged twice: once expecting the chord that was really played, once expecting a clearly different chord from the same song. The calibrated run uses two takes per chord from the same player's *other* progressions, never the recording under test. Download `annotation.zip` and `audio_mono-mic.zip` from the link above and unzip them into `datasets/guitarset/annotation` and `datasets/guitarset/audio` (git-ignored).

  Results (2,154 chords):

  | Style | Right chord wrongly flagged (built-in → calibrated) | Wrong chord caught |
  | --- | --- | --- |
  | Rock | 5.6% → 4.2% | 99–100% |
  | Singer-songwriter | 8.3% → 8.8% | 100% |
  | Bossa nova | 31.9% → 27.8% | 100% |
  | Jazz | 30.8% → 30.5% | 99.5% |
  | Funk | 31.6% → 31.9% | 99.5–100% |
  | **All** | **21.6% → 20.6%** | **99.6–99.9%** |

  In plain words: a wrong chord is almost always caught. With strummed rock and pop chords, a correctly played chord is wrongly flagged about 1 time in 20. Jazz-style voicings (extended chords, missing roots) are wrongly flagged about 1 time in 3. The evaluation led to two changes:
  - A rival chord that shares nearly all its notes with the expected one (a rootless Ebmaj7 sounds exactly like Gm) no longer counts as "a different chord". Before this, 27.7% of correct chords were flagged.
  - Calibration originally learned a template per chord. On this data that *raised* false flags to 31.8%, so it was rebuilt as described above.

**About the audio tests.** Every audio test uses *synthetic* signals: Karplus-Strong plucked strings strummed in real voicings, plus sines and noise. In the browser tests, `getUserMedia` is replaced by a stream that plays those synthetic WAV files. Chromium's built-in fake-microphone flags still wait for the operating system's microphone permission on macOS, which isn't available in the test environment. Everything after `getUserMedia` (the worklet, worker, analysis and UI) is the real code.

Apart from the GuitarSet evaluation above (one studio, one acoustic guitar model, a good microphone), none of this proves accuracy with your guitar, microphone or room, or with commercial recordings.
