/**
 * IndexedDB persistence. This browser profile is always the working copy; when
 * the player signs in, src/lib/sync copies changes to and from their account.
 * Without an account, clearing site data removes everything, which is why
 * backups exist.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PracticeSession } from "../coach/types";
import {
  nowIso,
  newId,
  type AudioBlobRecord,
  type Recording,
  type Song,
} from "../song/model";
import { defaultAlignment } from "../song/alignment";
import { DEFAULT_SETTINGS, sharedSettingsChanged, withDefaults, type Settings } from "./settings";
import { migrateSong } from "./migrate";
import type { CalibrationData } from "../dsp/calibration";

interface GuitarCoachDB extends DBSchema {
  songs: { key: string; value: Song; indexes: { "by-updated": string; "by-created": string } };
  recordings: { key: string; value: Recording; indexes: { "by-song": string } };
  audio: { key: string; value: AudioBlobRecord };
  sessions: { key: string; value: PracticeSession; indexes: { "by-song": string; "by-started": string } };
  kv: { key: string; value: { key: string; value: unknown } };
  /** Sync bookkeeping: fingerprint of each item as last synced, plus the sync cursor. */
  syncmeta: { key: string; value: SyncMeta };
}

export interface SyncMeta {
  key: string;
  hash?: string;
  modified?: number;
  /** Uploaded-audio marker (recordings only). */
  audioSize?: number;
  /** "__state" row only. */
  userId?: string;
  cursor?: string;
}

export const DB_NAME = "guitarcoach";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<GuitarCoachDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<GuitarCoachDB>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available in this browser."));
  dbPromise ??= openDB<GuitarCoachDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 2 && db.objectStoreNames.contains("songs")) {
        db.createObjectStore("syncmeta", { keyPath: "key" });
        return;
      }
      db.createObjectStore("syncmeta", { keyPath: "key" });
      const songs = db.createObjectStore("songs", { keyPath: "id" });
      songs.createIndex("by-updated", "updatedAt");
      songs.createIndex("by-created", "createdAt");
      const recs = db.createObjectStore("recordings", { keyPath: "id" });
      recs.createIndex("by-song", "songId");
      db.createObjectStore("audio", { keyPath: "id" });
      const sessions = db.createObjectStore("sessions", { keyPath: "id" });
      sessions.createIndex("by-song", "songId");
      sessions.createIndex("by-started", "startedAt");
      db.createObjectStore("kv", { keyPath: "key" });
    },
    blocking() {
      // Another tab wants a newer schema: let it proceed.
      dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export async function resetDbConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

// ---------- change notifications (so open views refresh) ----------

type Listener = () => void;
const listeners = new Set<Listener>();
export function onDbChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let channel: BroadcastChannel | null = null;
export function notify() {
  listeners.forEach((l) => l());
  try {
    channel ??= typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("guitarcoach-db") : null;
    channel?.postMessage("changed");
  } catch {
    /* ignore */
  }
}
if (typeof BroadcastChannel !== "undefined" && typeof window !== "undefined") {
  const rx = new BroadcastChannel("guitarcoach-db");
  rx.onmessage = () => listeners.forEach((l) => l());
}

// ---------- songs ----------

export async function listSongs(): Promise<Song[]> {
  const db = await getDb();
  return (await db.getAll("songs")).map(migrateSong);
}

export async function getSong(id: string): Promise<Song | undefined> {
  const s = await (await getDb()).get("songs", id);
  return s ? migrateSong(s) : undefined;
}

export async function saveSong(song: Song): Promise<Song> {
  const db = await getDb();
  const toSave = { ...song, updatedAt: song.updatedAt || nowIso() };
  await db.put("songs", toSave);
  notify();
  return toSave;
}

/** Applies a change and marks the song as edited by the user. */
export async function updateSong(id: string, change: (s: Song) => Song, opts: { userEdit?: boolean } = { userEdit: true }): Promise<Song | undefined> {
  const db = await getDb();
  const tx = db.transaction("songs", "readwrite");
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done;
    return undefined;
  }
  const next = change(migrateSong(existing));
  const saved: Song = { ...next, updatedAt: nowIso(), userModified: opts.userEdit ? true : next.userModified };
  await tx.store.put(saved);
  await tx.done;
  notify();
  return saved;
}

export async function markPlayed(id: string, position?: Song["lastPosition"]): Promise<void> {
  await updateSong(id, (s) => ({ ...s, lastPlayedAt: nowIso(), lastPosition: position ?? s.lastPosition }), { userEdit: false });
}

export async function deleteSong(id: string): Promise<void> {
  const db = await getDb();
  const recs = await db.getAllFromIndex("recordings", "by-song", id);
  const tx = db.transaction(["songs", "recordings", "audio"], "readwrite");
  await tx.objectStore("songs").delete(id);
  for (const r of recs) {
    await tx.objectStore("recordings").delete(r.id);
    await tx.objectStore("audio").delete(r.id);
  }
  await tx.done;
  notify();
}

// ---------- recordings ----------

export async function listRecordings(songId: string): Promise<Recording[]> {
  const recs = await (await getDb()).getAllFromIndex("recordings", "by-song", songId);
  return recs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRecording(id: string): Promise<Recording | undefined> {
  return (await getDb()).get("recordings", id);
}

export async function addRecording(input: {
  songId: string;
  blob: Blob;
  name: string;
  durationSec: number;
  bpm: number;
}): Promise<Recording> {
  const db = await getDb();
  const id = newId("rec");
  const rec: Recording = {
    id,
    songId: input.songId,
    name: input.name,
    mimeType: input.blob.type || "audio/*",
    size: input.blob.size,
    durationSec: input.durationSec,
    createdAt: nowIso(),
    alignment: defaultAlignment(input.bpm),
  };
  const tx = db.transaction(["recordings", "audio", "songs"], "readwrite");
  await tx.objectStore("audio").put({ id, blob: input.blob });
  await tx.objectStore("recordings").put(rec);
  const song = await tx.objectStore("songs").get(input.songId);
  if (song) await tx.objectStore("songs").put({ ...song, activeRecordingId: id, updatedAt: nowIso() });
  await tx.done;
  notify();
  return rec;
}

/** A YouTube video used as the play-along recording (nothing is downloaded). */
export async function addYouTubeRecording(input: { songId: string; youtubeId: string; name: string; bpm: number }): Promise<Recording> {
  const db = await getDb();
  const rec: Recording = {
    id: newId("rec"),
    songId: input.songId,
    kind: "youtube",
    youtubeId: input.youtubeId,
    name: input.name,
    mimeType: "video/youtube",
    size: 0,
    durationSec: 0,
    createdAt: nowIso(),
    alignment: defaultAlignment(input.bpm),
  };
  const tx = db.transaction(["recordings", "songs"], "readwrite");
  await tx.objectStore("recordings").put(rec);
  const song = await tx.objectStore("songs").get(input.songId);
  if (song) await tx.objectStore("songs").put({ ...song, activeRecordingId: rec.id, updatedAt: nowIso() });
  await tx.done;
  notify();
  return rec;
}

export async function updateRecording(id: string, change: (r: Recording) => Recording): Promise<Recording | undefined> {
  const db = await getDb();
  const tx = db.transaction("recordings", "readwrite");
  const r = await tx.store.get(id);
  if (!r) {
    await tx.done;
    return undefined;
  }
  const next = change(r);
  await tx.store.put(next);
  await tx.done;
  notify();
  return next;
}

/** Replaces the audio of a recording, keeping its alignment only if asked. */
export async function replaceRecordingAudio(id: string, blob: Blob, durationSec: number, keepAlignment: boolean): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["recordings", "audio"], "readwrite");
  const r = await tx.objectStore("recordings").get(id);
  if (r) {
    await tx.objectStore("audio").put({ id, blob });
    await tx.objectStore("recordings").put({
      ...r,
      mimeType: blob.type || r.mimeType,
      size: blob.size,
      durationSec,
      analysis: keepAlignment ? r.analysis : undefined,
      alignment: keepAlignment ? r.alignment : defaultAlignment(r.alignment.bpm),
    });
  }
  await tx.done;
  notify();
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["recordings", "audio", "songs"], "readwrite");
  const r = await tx.objectStore("recordings").get(id);
  await tx.objectStore("recordings").delete(id);
  await tx.objectStore("audio").delete(id);
  if (r) {
    const song = await tx.objectStore("songs").get(r.songId);
    if (song && song.activeRecordingId === id) await tx.objectStore("songs").put({ ...song, activeRecordingId: null });
  }
  await tx.done;
  notify();
}

/** Where to fetch audio this device doesn't have yet (set by sync when signed in). */
let audioFallback: ((recordingId: string) => Promise<Blob | undefined>) | null = null;
export function setAudioFallback(fn: typeof audioFallback): void {
  audioFallback = fn;
}

export async function getAudioBlob(recordingId: string): Promise<Blob | undefined> {
  const local = (await (await getDb()).get("audio", recordingId))?.blob;
  if (local || !audioFallback) return local;
  return audioFallback(recordingId).catch(() => undefined);
}

// ---------- sessions ----------

export async function saveSession(s: PracticeSession): Promise<void> {
  await (await getDb()).put("sessions", s);
  notify();
}

export async function getSession(id: string): Promise<PracticeSession | undefined> {
  return (await getDb()).get("sessions", id);
}

export async function listSessions(songId?: string): Promise<PracticeSession[]> {
  const db = await getDb();
  const all = songId ? await db.getAllFromIndex("sessions", "by-song", songId) : await db.getAll("sessions");
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function deleteSession(id: string): Promise<void> {
  await (await getDb()).delete("sessions", id);
  notify();
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  try {
    const row = await (await getDb()).get("kv", "settings");
    return withDefaults(row?.value as Partial<Settings> | undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(change: Partial<Settings> | ((s: Settings) => Settings)): Promise<Settings> {
  const current = await getSettings();
  let next = typeof change === "function" ? change(current) : withDefaults({ ...current, ...change });
  if (sharedSettingsChanged(current, next)) next = { ...next, updatedAt: nowIso() };
  await (await getDb()).put("kv", { key: "settings", value: next });
  notify();
  return next;
}

// ---------- personal chord calibration ----------

export async function getCalibration(): Promise<CalibrationData> {
  try {
    const row = await (await getDb()).get("kv", "calibration");
    const v = row?.value as CalibrationData | undefined;
    return v?.version === 1 ? v : { version: 1, takes: [], updatedAt: nowIso() };
  } catch {
    return { version: 1, takes: [], updatedAt: nowIso() };
  }
}

export async function saveCalibration(change: (c: CalibrationData) => CalibrationData): Promise<CalibrationData> {
  const next = { ...change(await getCalibration()), updatedAt: nowIso() };
  await (await getDb()).put("kv", { key: "calibration", value: next });
  notify();
  return next;
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  // Sync bookkeeping goes too, so a signed-in device downloads the account's
  // data again instead of treating the wipe as "delete everything".
  const tx = db.transaction(["songs", "recordings", "audio", "sessions", "kv", "syncmeta"], "readwrite");
  await Promise.all([
    tx.objectStore("songs").clear(),
    tx.objectStore("recordings").clear(),
    tx.objectStore("audio").clear(),
    tx.objectStore("sessions").clear(),
    tx.objectStore("kv").clear(),
    tx.objectStore("syncmeta").clear(),
  ]);
  await tx.done;
  notify();
}
