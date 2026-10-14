import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRecording,
  clearAllData,
  deleteSong,
  getAudioBlob,
  getSettings,
  getSong,
  listRecordings,
  listSessions,
  listSongs,
  markPlayed,
  resetDbConnection,
  saveSession,
  saveSettings,
  saveSong,
  updateRecording,
  updateSong,
} from "./db";
import { createBackup, exportSong, restoreBackup } from "./backup";
import { createEmptySong } from "../song/model";
import { parseChordSheet } from "../parse/chordSheet";
import { songFromParsed } from "../song/build";
import { migrateSong } from "./migrate";
import type { PracticeSession } from "../coach/types";

const makeSong = (title = "Paper Boats") =>
  songFromParsed(parseChordSheet("[Verse]\nG   C\nfloating along\n"), { title, artist: "Harbour", source: { kind: "paste", importedAt: "" } });

const session = (songId: string): PracticeSession => ({
  id: `s_${Math.random()}`,
  songId,
  songTitle: "Paper Boats",
  songArtist: "Harbour",
  recordingId: null,
  mode: "learn",
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  activeSec: 30,
  speed: 1,
  bpm: 90,
  timingSource: "clock",
  micUsed: false,
  signalQuality: null,
  chordResults: [],
  summary: {
    chordTotal: 0, chordEvaluated: 0, correct: 0, wrong: 0, missed: 0, uncertain: 0, chordAccuracy: null,
    timingEvaluated: 0, onTime: 0, early: 0, late: 0, timingAccuracy: null, meanAbsOffsetMs: null, strumConsistency: null, tempoDriftPct: null,
  },
});

beforeEach(async () => {
  await clearAllData();
});

describe("songs", () => {
  it("persists across a fresh connection (like a page reload)", async () => {
    const s = await saveSong(makeSong());
    await resetDbConnection();
    const loaded = await getSong(s.id);
    expect(loaded?.title).toBe("Paper Boats");
    expect(loaded?.sections[0].lines[0].chords.map((c) => c.chord)).toEqual(["G", "C"]);
  });

  it("marks user edits and leaves play tracking as a non-edit", async () => {
    const s = await saveSong(makeSong());
    await markPlayed(s.id, { recordingId: null, time: 12 });
    expect((await getSong(s.id))!.userModified).toBe(false);
    expect((await getSong(s.id))!.lastPosition?.time).toBe(12);
    await updateSong(s.id, (x) => ({ ...x, title: "Paper Boats (live)" }));
    const after = await getSong(s.id);
    expect(after!.userModified).toBe(true);
    expect(after!.title).toBe("Paper Boats (live)");
  });

  it("deletes a song with its recordings and audio but keeps practice history", async () => {
    const s = await saveSong(makeSong());
    const rec = await addRecording({ songId: s.id, blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), name: "take", durationSec: 3, bpm: 90 });
    await saveSession(session(s.id));
    await deleteSong(s.id);
    expect(await getSong(s.id)).toBeUndefined();
    expect(await listRecordings(s.id)).toHaveLength(0);
    expect(await getAudioBlob(rec.id)).toBeUndefined();
    expect(await listSessions(s.id)).toHaveLength(1);
  });
});

describe("recordings", () => {
  it("stores audio separately from song content and sets it active", async () => {
    const s = await saveSong(makeSong());
    const rec = await addRecording({ songId: s.id, blob: new Blob([new Uint8Array(10)], { type: "audio/mpeg" }), name: "My take", durationSec: 10, bpm: 100 });
    expect((await getSong(s.id))!.activeRecordingId).toBe(rec.id);
    expect(rec.alignment).toMatchObject({ status: "none", bpm: 100, offsetSec: 0 });
    const blob = await getAudioBlob(rec.id);
    expect(blob?.size).toBe(10);
    await updateRecording(rec.id, (r) => ({ ...r, alignment: { ...r.alignment, status: "calibrated", offsetSec: 1.2 } }));
    expect((await listRecordings(s.id))[0].alignment.status).toBe("calibrated");
  });
});

describe("settings", () => {
  it("fills defaults and merges updates", async () => {
    expect((await getSettings()).a4).toBe(440);
    await saveSettings({ fontScale: 1.4 });
    const s = await getSettings();
    expect(s.fontScale).toBe(1.4);
    expect(s.timing.onTimeMs).toBe(70);
  });
});

describe("backup and restore", () => {
  it("round-trips songs, recordings with audio, sessions and settings", async () => {
    const s = await saveSong(makeSong());
    await addRecording({ songId: s.id, blob: new Blob([new Uint8Array([9, 8, 7])], { type: "audio/wav" }), name: "t", durationSec: 1, bpm: 90 });
    await saveSession(session(s.id));
    await saveSettings({ a4: 442 });
    const backup = JSON.parse(JSON.stringify(await createBackup({ includeAudio: true })));
    await clearAllData();
    const report = await restoreBackup(backup, { restoreSettings: true });
    expect(report).toMatchObject({ songsAdded: 1, recordingsAdded: 1, sessionsAdded: 1, audioRestored: 1 });
    const recs = await listRecordings(s.id);
    expect(new Uint8Array(await (await getAudioBlob(recs[0].id))!.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    expect((await getSettings()).a4).toBe(442);
  });

  it("never overwrites a song that was edited since the backup", async () => {
    const s = await saveSong(makeSong());
    const backup = JSON.parse(JSON.stringify(await createBackup({ includeAudio: false })));
    await updateSong(s.id, (x) => ({ ...x, sections: parseChordSheet("[Verse]\nAm F\nchanged words\n").sections }));
    const report = await restoreBackup(backup);
    expect(report.songsCopied).toBe(1);
    const all = await listSongs();
    expect(all).toHaveLength(2);
    const original = all.find((x) => x.id === s.id)!;
    expect(original.sections[0].lines[0].chords.map((c) => c.chord)).toEqual(["Am", "F"]);
    expect(all.find((x) => x.id !== s.id)!.title).toMatch(/restored copy/);
  });

  it("skips identical songs and rejects foreign files", async () => {
    const s = await saveSong(makeSong());
    const file = JSON.parse(JSON.stringify(await exportSong(s.id, { includeAudio: false })));
    expect((await restoreBackup(file)).songsSkipped).toBe(1);
    await expect(restoreBackup({ hello: "world" })).rejects.toThrow(/isn't a GuitarCoach/);
  });
});

describe("migration", () => {
  it("fills missing fields on old records and refuses newer schemas", () => {
    const m = migrateSong({ id: "x", title: "Old", sections: [] });
    expect(m.tempo.status).toBe("none");
    expect(m.strumPatterns).toEqual([]);
    expect(() => migrateSong({ ...createEmptySong(), schemaVersion: 99 })).toThrow(/newer version/);
  });
});
