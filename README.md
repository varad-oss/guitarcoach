# GuitarCoach

A personal guitar practice studio that runs in your browser. Bring in a song from a link, a file, a recording or the clipboard, play along with a metronome or your own recording, and get feedback that comes from the guitar you actually play into the microphone.

Your songs, recordings and practice history live in the browser (IndexedDB), so everything works offline. Optionally, sign in to sync them between devices (e.g. laptop and phone). Microphone audio is analysed in the browser and never uploaded.

## Run it

Requirements: Node.js 20 or newer (developed on Node 26), npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. For the production build (needed for offline/PWA support):

```bash
npm run build
```

```bash
npm start
```

### Checks

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests (Vitest): parsing, import/SSRF, timeline and alignment, DSP, coaching, persistence, backup |
| `npm run test:e2e` | Browser tests (Playwright, Chromium) against `next start` on port 3100. Run `npm run build` first. |
| `npm run test:live` | Opt-in live import of the real Ultimate Guitar page used during development (network required) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run test:all` | All of the above except the live test |

First time only, Playwright needs its browser: `npx playwright install chromium`.

## Using it

1. **Add Song**: paste a link (Ultimate Guitar or a raw text/ChordPro file on GitHub/Gist), paste chords, upload a file (text, ChordPro, PDF, image, GuitarCoach JSON), upload a recording on its own, start blank, or use the browser-tab bookmarklet for any other site.
2. **Check and save**: the preview flags lines it wasn't sure about; click a chord to rename or remove it, or switch to the text editor. Duplicates are detected, and a song you've edited is never overwritten by a re-import.
3. **Recordings & timing** (optional): add your own recording. GuitarCoach estimates the beat and where the sheet starts. Refine it in *Align timing* by tapping along, dragging chord changes, or nudging the whole timeline, then mark it verified.
4. **Practice Studio**: play along with the metronome (exact timing), your own recording (pitch-preserving slow-down), or a YouTube video (played in YouTube's own embedded player; align it once by tapping along). Turn on *Listen to me* for live chord and timing feedback. Loop sections, change speed, count in, and follow the scrolling sheet. *Finish* saves a report.
   The toolbar under the sheet transposes, changes the capo (it tells you which key the song then sounds in), simplifies chords (Cadd9 → C, D/F# → D) and hides chords. Chord detection follows whatever you choose. Chord diagrams show fingers and barres, and you can flip through alternate voicings.
5. **Progress** shows practice time, accuracy per session and the changes that trip you up, all from sessions you've actually completed.

**Chord calibration** (Practice Studio → Tools, or Settings): record two takes of each chord you play. GuitarCoach learns two things and applies both to every chord it considers, so neither favours the chord you're supposed to play:
- how each chord *type* (major, minor, 7th …) sounds on your setup, moved to every root, so recording G and C also helps with A;
- any note your guitar or room adds to everything (a ringing body resonance, say).

Each learned template is blended 50/50 with the built-in one. A take that clearly sounds like a different chord is flagged before it's learned. The page reports, per chord, how often it's recognised and how often a correct chord gets wrongly flagged, with and without your calibration, testing each take only against your *other* takes. On a synthetic guitar with a strong ringing resonance, the built-in templates recognised 37% and wrongly flagged 56%; with calibration, 81% and 11%. On real recordings (GuitarSet, below) the gain is small.

Other tools: Free play (shows the chord it hears), Chord drill, Rhythm drill (strum timing against a pattern, tempo and drift), Chord changes trainer (one-minute changes), Tuner (standard tuning). Calibrate latency in Settings for accurate timing.

**Get-ready countdown.** Anything that listens and judges waits 3 seconds after you press the button, so you can pick up the guitar. That covers Play while listening, turning listening on mid-song, starting a drill or the one-minute changes, recording a calibration take, and the latency check. Esc cancels, Enter starts at once, and Settings → Microphone and audio switches it between Off, 3 and 5 seconds. Free play and the tuner don't judge anything, so they start straight away.

Keyboard in the studio: Space play/pause, ← → previous/next line, L loop section, M metronome, F follow, + / − speed.

## How it's built

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

## Accounts and sync (optional)

Without any setup, GuitarCoach keeps everything on the device. With a free [Supabase](https://supabase.com) project, the **Account** page offers sign-in (Google, or a code sent by email) and syncs:
- songs and edits;
- recordings, including uploaded audio (up to 50 MB per file);
- alignments, practice sessions and reports;
- chord calibration and most settings.

Latency, microphone choice and text size stay per device. The browser copy is always the working copy: changes are saved locally first and synced in the background (after edits, when the connection returns, when the app comes back to the foreground, and every 5 minutes). If two devices change the same item, the newer change wins. Audio is downloaded to a device the first time that recording is played there. Deleting a song deletes it everywhere; *Remove everything from this device* in Settings doesn't touch the account.

Setup, once:
1. Create a Supabase project. In **SQL Editor**, run [`supabase/setup.sql`](supabase/setup.sql). It creates the `records` table and the private `audio` bucket, with rules that let each person read and write only their own data.
2. In **Authentication → URL Configuration**:
   - set *Site URL* to your deployed address (e.g. `https://guitarcoach.vercel.app`);
   - add `https://<that address>/account` and `http://localhost:3000/account` to *Redirect URLs*.
3. Optional: in **Authentication → Emails**, add `{{ .Token }}` to the *Magic Link* and *Confirm signup* templates, so the email also carries a code. This matters on a phone, where the sign-in link often opens in a different browser from the app; an iPhone home-screen app never shares storage with Safari. Supabase only allows template edits with your own SMTP server; a Gmail address with an app password works (`smtp.gmail.com`, port 465). Without it, use Google sign-in on phones.
4. For Google sign-in:
   - In Google Cloud Console, create an OAuth client (type *Web application*) with the authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Paste its client ID and secret into Supabase under **Authentication → Sign In / Providers → Google**.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (from **Project Settings → API Keys**) in `.env.local` and in your hosting provider, then rebuild. Both values are meant to be public; the access rules above protect the data. See `.env.example`.

Free Supabase projects pause after a week without any activity. To prevent that, a daily Vercel Cron job (`vercel.json`) calls `/api/keepalive`, which makes one tiny read from the database. Without a signed-in user, the access rules return no rows. If you set a `CRON_SECRET` environment variable in Vercel, only Vercel's scheduler can call that route. If the project pauses anyway, the app keeps working on each device; restore the project from the Supabase dashboard to sync again.

The sync engine (`src/lib/sync/engine.ts`) is unit-tested with two simulated devices. It covers edits, deletions, conflicts, per-device settings, wiping a device, merging on first sign-in, separate accounts, and audio upload and download.

## Deploying

The app deploys to [Vercel](https://vercel.com) as is. Import the GitHub repository, add the two environment variables above if you use accounts, and deploy. The free Hobby plan is for personal, non-commercial use. HTTPS is required for the microphone on phones, and Vercel provides it.

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

## Limitations

- **Chord recognition is template-based.** Expect it to be reliable for clear strums of common open and barre chords. It is less reliable for:
  - fast changes,
  - heavy distortion,
  - single-note playing,
  - voicings that share most notes (Em7 vs G6, for example),
  - noisy rooms.
  
  When it isn't sure it says so, and those moments aren't counted as mistakes. On real recordings, extended jazz-style voicings are wrongly flagged about 1 time in 3 (see GuitarSet results).
- **Strum direction (down/up) isn't detected.** Only strum timing is evaluated.
- **Chord lengths on imported sheets are guessed** (one bar per chord, half a bar for chords squeezed together) unless the sheet uses bar notation or you set them. They're marked as guessed.
- **Timing against a recording is only as good as its alignment.** Estimated alignments drive guided scrolling, but millisecond timing feedback is shown only for metronome practice and for calibrated or verified recordings.
- **Slowing a recording** uses the browser's built-in pitch-preserving playback (`preservesPitch`). Quality drops at very slow speeds, and browsers without it change pitch; the studio says so.
- **Latency** is estimated from browser-reported values until you run the calibration in Settings.
- **Audio-only transcription** (tempo, beats, chords, sections) is an estimate and needs checking. Sections are labelled A/B/C, not verse/chorus.
- **PDF and OCR import** can shift chord positions, so they're flagged for review. OCR loads about 15 MB of on-device model files the first time.
- **Lyric-only lines** inside a section (for example, a verse whose chords were only written for the first verse) aren't timed.
- **Clearing the site's browser data deletes everything** unless you've exported a backup. Use *Ask the browser to keep my data* in Settings.
- **YouTube videos can't be analysed** (their audio isn't accessible), so their timing is set by tapping along or nudging, not automatically. YouTube may round slow speeds to the rates it supports; the studio shows the real one. While listening with the microphone, use headphones so it hears your guitar and not the video.
- **Link import needs the network and the running Next.js server.** Practice, the library, the tuner and analysis work offline after the first visit (production build).
