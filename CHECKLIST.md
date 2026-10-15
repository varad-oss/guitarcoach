# GuitarCoach implementation checklist

Status legend: [x] done and verified by tests and/or in the browser, [~] done with caveats (see notes), [ ] not done

## Phase 1: Foundation
- [x] Next.js 16 + React 19 + TypeScript + Tailwind v4, ESLint, Vitest, Playwright
- [x] Design tokens (charcoal / sage green), app shell, keyboard-accessible navigation, mobile bottom bar
- [x] Versioned Song model (content) separate from Recording (audio + alignment) and PracticeSession
- [x] IndexedDB persistence (songs, recordings, audio blobs, sessions, settings) with migration
- [x] My Songs library: search, sort, filter, favorites, delete with confirmation

## Phase 2: Import
- [x] Chord-symbol parser (major/minor/7/sus/slash/add/dim/aug/power), transpose, normalise
- [x] Chord-sheet parser (chords over lyrics, inline chords, headings, % repeats, x2, beat slashes, tab blocks, chord shapes, metadata, flagged lines)
- [x] ChordPro parser + exporter; plain-text exporter
- [x] Source-adapter registry; Ultimate Guitar adapter (live-tested); raw-text (GitHub raw / Gist) adapter (unit-tested only)
- [x] SSRF-safe server fetch (host allowlist, DNS/IP checks at connect, redirect validation, timeout, size cap, rate limit, same-origin)
- [x] Add Song flow: link / paste / file / recording / blank / browser tab, editable preview, duplicate handling, fallback on failure
- [~] PDF text extraction and image OCR (on-device; chord positions may shift and are flagged)
- [x] Bookmarklet "import from browser tab"

## Phase 3: Practice Studio
- [x] Clock transport (metronome-driven) and media transport (uploaded recording, pitch-preserving speed via the browser)
- [x] Timeline: chord lengths, repeats, beat grid, beat↔time mapping, timing status
- [x] Sheet renderer with active chord/line, follow-mode autoscroll tied to playback time, guided resync
- [x] Metronome (lookahead scheduler), count-in, subdivisions, compound meters, section loop, speed presets + custom

## Phase 4: Audio analysis
- [x] AudioWorklet capture → Web Worker DSP (FFT, chroma, chord templates, onset flux, YIN)
- [~] Live chord detection with smoothing and expected-vs-detected verdicts (verified on synthetic audio only)
- [~] Tuner (standard tuning, cents, confidence; verified on synthetic audio only)
- [x] Latency calibration (strum-along)

## Phase 5: Coaching and reports
- [x] Timing coach (early / on time / late / missed / unknown) gated on alignment quality
- [x] Strumming coach (pattern grid, onset matching, consistency; no direction claims)
- [x] Tempo estimation from onsets (refuses with fewer than 8 onsets), drift view
- [x] Practice modes: Learn, Chord drill, Rhythm drill, Full song, Performance, Free play
- [x] Chord change trainer
- [x] Session reports, per-song history, Progress page
- [~] Audio-only import: tempo, beat grid, estimated chords, sections (estimates; synthetic-tested)
- [x] Alignment workflow: auto estimate, tap-along, drag chord changes, whole-timeline nudge, chord lengths, verification

## Phase 6: Production readiness
- [x] PWA manifest + service worker, offline indicator (offline reload verified in the browser tests)
- [x] JSON backup / restore, single-song export (ChordPro, text, JSON), storage persistence request
- [x] Unit tests, browser tests, production build, lint, typecheck
- [x] README with run instructions and honest limitations

## Ultimate Guitar extras and premium-style features (added 2026-10-15)
- [x] Import UG strumming patterns (decoded: down/up, accents, mutes, palm mutes, rests, triplets), per-section patterns followed in the studio
- [x] Import all UG chord voicings with fingers and barres; voicing switcher with "Use this one"
- [x] Import rating, difficulty, author, views, original key, tuning; list other versions with one-click import (paid ones listed, not fetched)
- [x] Transpose / capo / simplify / chords on-off toolbar (song page and studio), key status, detection follows it
- [x] "Easiest shapes": one click to simplified chords and the capo position with the easiest (open) shapes, same sound
- [x] Play along with a YouTube video (official embedded player): speed, loop, seek, tap-along alignment
- [x] Bookmarklet sends the same full UG page data

## Personal chord calibration (added 2026-10-15)
- [x] Record labelled takes per chord (stored as chroma on this device), mislabel check, per-chord report (built-in vs calibrated, leave-one-take-out)
- [x] Personal chord-type templates (blended with built-in) plus an ambient/resonance profile, applied to all candidate chords alike; can be switched off
- [x] Evaluation on GuitarSet (180 real recordings, `npm run eval:guitarset`); led to the note-overlap rule and the calibration redesign (README has results)

## Not done / future
- [~] Validation against real recordings: chord judging evaluated on GuitarSet; not yet with the user's own guitar/mic, and timing not yet validated on real audio
- [ ] Companion browser extension (the bookmarklet covers the same need for now)
- [ ] Higher-quality time-stretching (e.g. a WASM phase vocoder) for very slow speeds
- [ ] Strum-direction detection (deliberately not attempted without acoustic evidence)
- [ ] Stem separation (an on-device alternative to UG's paid per-instrument mixer, for your own recordings)
