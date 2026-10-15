# User guide

[← Back to the README](../README.md)


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
