# How GuitarCoach works

[← Back to the README](../README.md)

## Stack and layout


Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · `idb` · `undici` (server fetch) · `pdfjs-dist` and `tesseract.js` (on-device PDF/OCR, served from `public/vendor`) · Vitest · Playwright.

```
src/lib/music      chord symbols (parse, normalise, transpose, compatibility), meters, guitar shapes
src/lib/parse      chord-sheet, Ultimate Guitar markup and ChordPro parsers; text/ChordPro export
src/lib/song       versioned Song model, timeline (beats), alignment (beats ↔ seconds), duplicates
src/lib/import     source-adapter registry, adapters, SSRF-safe server fetch, bookmarklet, PDF/OCR
src/lib/db         IndexedDB stores, settings, migration, backup/restore
src/lib/dsp        FFT, chroma, chord templates, onsets, YIN pitch, tempo, beat tracking, file analysis, synth (tests)
src/lib/audio      AudioContext, mic capture (AudioWorklet → Worker), transports, metronome, latency
src/lib/coach      live chord tracker, per-chord evaluation, strumming, transitions, report summary
src/lib/studio     React hooks wiring mic, playback and sessions together
src/components     UI: shell, sheet renderer, import flow, studio modes, pages, charts
src/app            routes (all static except POST /api/import)
public/worklets    capture AudioWorklet;  public/sw.js  service worker
```

**Data model.** `Song` (schema version 1) holds content only: sections, lines, chord events with character positions and optional lengths in bars, tempo, meter, capo, shapes, strum patterns, source and parse confidence. Each `Recording` holds its audio blob reference and its own `Alignment` (BPM, offset, optional measured beat grid, per-chord manual times, status). `PracticeSession` stores per-chord results and summaries. Timing status is always one of *none / estimated / calibrated / verified*.

**Audio analysis.** The microphone feeds an AudioWorklet that only copies samples to a Web Worker. The worker runs:
- an 8192-point FFT,
- peak-based chroma,
- harmonic chord-template matching (major, minor, 7ths, sus, add9, power, dim),
- log spectral-flux onsets with adaptive peak picking,
- YIN for the tuner.

On the main thread, the live display is smoothed (exponential average, reset on each strum, plus hysteresis). Per-chord verdicts compare the expected chord against its strongest *incompatible* rival. A chord is called wrong only when another chord fits clearly better; unclear audio is reported as unclear and left out of accuracy. Uploaded recordings get a DP beat tracker, beat-synchronous chroma with Viterbi smoothing, downbeat and section estimates, and a search for where the sheet starts.

## Sync engine

Covered in [Accounts and sync](accounts-and-sync.md). In short, the browser copy is always the working copy, each sync compares every item with a fingerprint from the last sync, the newer change wins, and audio goes to a private storage bucket. The engine lives in `src/lib/sync/engine.ts`.

## Importing from links

The server route `POST /api/import` fetches one page per user action, only from hosts an adapter lists (`tabs.ultimate-guitar.com`, `raw.githubusercontent.com`, `gist.githubusercontent.com`). The fetch has these protections:
- https only, on the default port.
- No credentials in URLs; IP literals and `localhost` are refused.
- DNS answers are checked at connect time, so private, loopback, link-local and NAT64 addresses are refused, which also covers DNS rebinding.
- Redirects are followed manually and each hop is re-validated.
- 12-second timeout, size caps (3 MB HTML, 512 KB text), a same-origin check, and a small rate limit.
- Bot checks and 401/403/429 responses are reported as "the site didn't let GuitarCoach read this page". They are never worked around.

The Ultimate Guitar adapter reads everything the free tab page embeds in its HTML: the same data a browser receives. It uses no login and no separate API. It imports:
- the chords and lyrics (sections, positions, chord definitions in the sheet);
- the site's strumming patterns, decoded with the site's own code table (down/up, accents, muted and palm-muted strums, rests, triplets), with patterns written for a section ("Chorus – Alternative Pattern") followed automatically in the studio;
- every guitar voicing in the site's chord library for the song's chords (up to 13 per chord), with finger numbers and barres;
- rating, votes, difficulty, author and contributors, views, favourites, original key, capo and tuning;
- the list of other versions, each importable in one click.

Paid products (Official, Pro, Guitar Pro, Power tabs, the official backing tracks and per-instrument mixer) are listed but never fetched. That embedded structure is not a documented interface and may change; if it does, the import fails clearly and you can paste the sheet or use the bookmarklet, which hands over the same data from your own open tab.

You can switch the source off in Settings, or set `GUITARCOACH_DISABLED_ADAPTERS=ultimate-guitar` on the server.

**YouTube play-along** uses YouTube's official IFrame Player API on the privacy-enhanced `youtube-nocookie.com` host. GuitarCoach only drives the player (play, pause, seek, speed) and follows its clock; it never downloads or analyses the audio, so a video's timing comes from tapping along or nudging in *Align timing*, and it needs an internet connection. Some videos' owners don't allow embedding; the studio says so.

**Adding a source** means writing a `SourceAdapter` (hosts, URL matcher, `extract`) in `src/lib/import/adapters/` and listing it in `registry.ts`.
