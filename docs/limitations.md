# Limitations

[← Back to the README](../README.md)


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
- **Clearing the site's browser data deletes everything** unless you're signed in (your account keeps a copy) or you've exported a backup. Use *Ask the browser to keep my data* in Settings.
- **YouTube videos can't be analysed** (their audio isn't accessible), so their timing is set by tapping along or nudging, not automatically. YouTube may round slow speeds to the rates it supports; the studio shows the real one. While listening with the microphone, use headphones so it hears your guitar and not the video.
- **Link import needs the network and the running Next.js server.** Practice, the library, the tuner and analysis work offline after the first visit (production build).
