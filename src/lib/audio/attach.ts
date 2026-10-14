"use client";

import { addRecording, getRecording, getSong, updateRecording, updateSong, getAudioBlob } from "../db/db";
import { analyseInWorker, audioDuration, decodeForAnalysis } from "./analyzeFile";
import { alignSheetToBeats } from "../dsp/fileAnalysis";
import { alignmentFromAnalysis, analysisSummary } from "../song/fromAnalysis";
import { buildTimeline } from "../song/timeline";
import { effectiveBpm, type Recording, type Song } from "../song/model";
import { meterInfo } from "../music/meter";
import { shapeToMidi } from "../music/shapes";
import { transposeChord } from "../music/chords";

export async function attachRecording(song: Song, file: File): Promise<Recording> {
  const duration = await audioDuration(file).catch(() => 0);
  return addRecording({ songId: song.id, blob: file, name: file.name, durationSec: duration, bpm: effectiveBpm(song) });
}

/**
 * Estimates the beat grid of a recording and, if the song has chords, where the
 * sheet starts in it. Saves the result as an *estimated* alignment, unless the
 * user has already calibrated or verified the timing.
 */
export async function estimateAlignment(recordingId: string, a4 = 440, onProgress?: (p: number) => void): Promise<{ aligned: boolean; bpm: number | null }> {
  const rec = await getRecording(recordingId);
  if (!rec) throw new Error("Recording not found");
  const song = await getSong(rec.songId);
  if (!song) throw new Error("Song not found");
  const blob = await getAudioBlob(recordingId);
  if (!blob) throw new Error("The audio for this recording is missing.");
  const audio = await decodeForAnalysis(blob);
  const beatsPerBar = meterInfo(song.timeSignature).beatsPerBar;
  const analysis = await analyseInWorker(audio, { beatsPerBar, targetBpm: song.tempo.bpm, a4 }, onProgress);

  const tl = buildTimeline(song);
  let startBeat = analysis.downbeatIndex;
  let aligned = false;
  if (tl.events.length > 0 && analysis.beatChroma.length > 0) {
    const events = tl.events.slice(0, 48).map((e) => {
      const shape = song.chordShapes[e.chord]?.frets;
      return {
        chord: song.capo ? transposeChord(e.chord, song.capo) : e.chord,
        startBeat: e.startBeat,
        beats: e.beats,
        voicing: shape ? shapeToMidi(shape, song.capo) : undefined,
      };
    });
    const fit = alignSheetToBeats(events, analysis.beatChroma, analysis.beatTonal);
    if (fit && fit.score > 0.35) {
      startBeat = fit.startBeat;
      aligned = true;
    }
  }

  await updateRecording(recordingId, (r) => {
    const keepUserTiming = r.alignment.status === "calibrated" || r.alignment.status === "verified";
    return {
      ...r,
      durationSec: r.durationSec || audio.duration,
      analysis: analysisSummary(analysis),
      alignment: keepUserTiming ? r.alignment : alignmentFromAnalysis(analysis, effectiveBpm(song), startBeat),
    };
  });
  if (!song.tempo.bpm && analysis.bpm) {
    await updateSong(song.id, (s) => ({ ...s, tempo: { bpm: Math.round(analysis.bpm!), source: "audio-analysis", status: "estimated" } }), { userEdit: false });
  }
  return { aligned, bpm: analysis.bpm };
}
