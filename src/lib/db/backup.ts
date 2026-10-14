/**
 * JSON backup/restore and single-song export. Restores never overwrite an
 * existing song that differs: conflicting songs are added as copies.
 */

import type { PracticeSession } from "../coach/types";
import { newId, nowIso, type Recording, type Song } from "../song/model";
import { getDb, notify } from "./db";
import { migrateSong } from "./migrate";
import type { Settings } from "./settings";

export const BACKUP_FORMAT = "guitarcoach-backup";
export const SONG_FILE_FORMAT = "guitarcoach-song";

interface AudioEntry {
  id: string;
  mimeType: string;
  base64: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT | typeof SONG_FILE_FORMAT;
  version: 1;
  app: "GuitarCoach";
  exportedAt: string;
  songs: Song[];
  recordings: Recording[];
  sessions: PracticeSession[];
  settings?: Settings;
  audio?: AudioEntry[];
}

export interface RestoreReport {
  songsAdded: number;
  songsCopied: number;
  songsSkipped: number;
  recordingsAdded: number;
  sessionsAdded: number;
  audioRestored: number;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function createBackup(opts: { includeAudio: boolean }): Promise<BackupFile> {
  const db = await getDb();
  const [songs, recordings, sessions, settingsRow] = await Promise.all([
    db.getAll("songs"),
    db.getAll("recordings"),
    db.getAll("sessions"),
    db.get("kv", "settings"),
  ]);
  const audio: AudioEntry[] = [];
  if (opts.includeAudio) {
    for (const r of recordings) {
      const a = await db.get("audio", r.id);
      if (a) audio.push({ id: r.id, mimeType: r.mimeType, base64: await blobToBase64(a.blob) });
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: 1,
    app: "GuitarCoach",
    exportedAt: nowIso(),
    songs,
    recordings,
    sessions,
    settings: settingsRow?.value as Settings | undefined,
    audio: opts.includeAudio ? audio : undefined,
  };
}

export async function exportSong(songId: string, opts: { includeAudio: boolean }): Promise<BackupFile> {
  const db = await getDb();
  const song = await db.get("songs", songId);
  if (!song) throw new Error("Song not found");
  const recordings = await db.getAllFromIndex("recordings", "by-song", songId);
  const audio: AudioEntry[] = [];
  if (opts.includeAudio) {
    for (const r of recordings) {
      const a = await db.get("audio", r.id);
      if (a) audio.push({ id: r.id, mimeType: r.mimeType, base64: await blobToBase64(a.blob) });
    }
  }
  return {
    format: SONG_FILE_FORMAT,
    version: 1,
    app: "GuitarCoach",
    exportedAt: nowIso(),
    songs: [song],
    recordings,
    sessions: [],
    audio: opts.includeAudio ? audio : undefined,
  };
}

export function isBackupFile(data: unknown): data is BackupFile {
  const d = data as BackupFile;
  return !!d && typeof d === "object" && (d.format === BACKUP_FORMAT || d.format === SONG_FILE_FORMAT) && Array.isArray(d.songs);
}

function sameContent(a: Song, b: Song): boolean {
  return a.updatedAt === b.updatedAt && JSON.stringify(a.sections) === JSON.stringify(b.sections);
}

export async function restoreBackup(data: unknown, opts: { restoreSettings?: boolean } = {}): Promise<RestoreReport> {
  if (!isBackupFile(data)) throw new Error("This file isn't a GuitarCoach backup or song file.");
  if (data.version > 1) throw new Error("This backup was made by a newer version of GuitarCoach.");
  const db = await getDb();
  const report: RestoreReport = { songsAdded: 0, songsCopied: 0, songsSkipped: 0, recordingsAdded: 0, sessionsAdded: 0, audioRestored: 0 };
  const songIdMap = new Map<string, string>();
  const recIdMap = new Map<string, string>();
  const audioById = new Map((data.audio ?? []).map((a) => [a.id, a]));

  for (const raw of data.songs) {
    const incoming = migrateSong(raw);
    const existing = await db.get("songs", incoming.id);
    if (!existing) {
      await db.put("songs", incoming);
      songIdMap.set(incoming.id, incoming.id);
      report.songsAdded++;
    } else if (sameContent(existing, incoming)) {
      songIdMap.set(incoming.id, incoming.id);
      report.songsSkipped++;
    } else {
      const copy: Song = { ...incoming, id: newId("song"), title: `${incoming.title} (restored copy)`, updatedAt: nowIso() };
      await db.put("songs", copy);
      songIdMap.set(incoming.id, copy.id);
      report.songsCopied++;
    }
  }

  for (const r of data.recordings ?? []) {
    const songId = songIdMap.get(r.songId);
    if (!songId) continue;
    const exists = await db.get("recordings", r.id);
    const id = exists && exists.songId !== songId ? newId("rec") : r.id;
    if (exists && exists.songId === songId) {
      recIdMap.set(r.id, r.id);
      continue;
    }
    recIdMap.set(r.id, id);
    await db.put("recordings", { ...r, id, songId });
    report.recordingsAdded++;
    const a = audioById.get(r.id);
    if (a) {
      await db.put("audio", { id, blob: base64ToBlob(a.base64, a.mimeType) });
      report.audioRestored++;
    }
  }

  for (const s of data.sessions ?? []) {
    if (await db.get("sessions", s.id)) continue;
    await db.put("sessions", {
      ...s,
      songId: s.songId ? songIdMap.get(s.songId) ?? s.songId : null,
      recordingId: s.recordingId ? recIdMap.get(s.recordingId) ?? s.recordingId : null,
    });
    report.sessionsAdded++;
  }

  // Point copied songs at their restored recordings.
  for (const [oldId, newSongId] of songIdMap) {
    if (oldId === newSongId) continue;
    const s = await db.get("songs", newSongId);
    if (s?.activeRecordingId) await db.put("songs", { ...s, activeRecordingId: recIdMap.get(s.activeRecordingId) ?? null });
  }

  if (opts.restoreSettings && data.settings) await db.put("kv", { key: "settings", value: data.settings });
  notify();
  return report;
}
