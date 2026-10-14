/**
 * Two-way sync between this browser's IndexedDB (always the working copy) and
 * the player's account.
 *
 * Instead of hooking every write, each sync compares every item with the
 * fingerprint it had at the last sync, so any change (edits, imports, backup
 * restores, deletions) is picked up. Conflicts go to the newer change. Audio
 * files of uploaded recordings are uploaded after their recording, and other
 * devices download them the first time they're played there.
 */

import { getDb, type SyncMeta } from "../db/db";
import { DEVICE_SETTINGS } from "../db/settings";

export type SyncStore = "songs" | "recordings" | "sessions" | "kv";
const STORES: SyncStore[] = ["songs", "recordings", "sessions", "kv"];
/** Settings rows in "kv" that follow the player; anything else stays on the device. */
const SYNCED_KV = new Set(["settings", "calibration"]);
/** Supabase's free plan accepts files up to 50 MB. */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const STATE_KEY = "__state";

export interface RemoteRow {
  store: SyncStore;
  id: string;
  data: unknown;
  deleted: boolean;
  /** Client clock (ms) of the change. */
  modified: number;
  /** Server clock; the sync cursor. */
  updated_at: string;
}

export interface Remote {
  userId: string;
  /** Every row changed after `since` (all rows when null), oldest first. */
  pull(since: string | null): Promise<RemoteRow[]>;
  push(rows: Array<Omit<RemoteRow, "updated_at">>): Promise<void>;
  uploadAudio(id: string, blob: Blob): Promise<void>;
  downloadAudio(id: string): Promise<Blob | null>;
  removeAudio(ids: string[]): Promise<void>;
}

export interface SyncResult {
  downloaded: number;
  uploaded: number;
  audioUploaded: number;
  /** Recordings whose audio is too large to upload; they stay on this device. */
  audioTooLarge: string[];
  errors: string[];
}

interface LocalItem {
  store: SyncStore;
  id: string;
  data: unknown;
  modified?: number;
}

const keyOf = (store: string, id: string) => `${store}:${id}`;

/** FNV-1a over the JSON text; only used to notice changes. */
export function fingerprint(data: unknown): string {
  const s = JSON.stringify(data) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${s.length}`;
}

/** The part of a kv row that follows the player between devices. */
function shared(store: SyncStore, id: string, data: unknown): unknown {
  if (store !== "kv" || id !== "settings" || !data || typeof data !== "object") return data;
  const copy = { ...(data as Record<string, unknown>) };
  for (const k of DEVICE_SETTINGS) delete copy[k];
  return copy;
}

async function readLocal(): Promise<Map<string, LocalItem>> {
  const db = await getDb();
  const out = new Map<string, LocalItem>();
  for (const store of STORES) {
    if (store === "kv") {
      for (const row of await db.getAll("kv")) {
        if (!SYNCED_KV.has(row.key)) continue;
        // Never-changed settings (no updatedAt) count as oldest, so a new device's defaults don't win.
        const t = Date.parse((row.value as { updatedAt?: string } | undefined)?.updatedAt ?? "");
        out.set(keyOf("kv", row.key), { store, id: row.key, data: shared("kv", row.key, row.value), modified: Number.isFinite(t) ? t : 0 });
      }
      continue;
    }
    for (const rec of await db.getAll(store)) {
      const r = rec as { id: string; updatedAt?: string };
      const t = r.updatedAt ? Date.parse(r.updatedAt) : NaN;
      out.set(keyOf(store, r.id), { store, id: r.id, data: rec, modified: Number.isFinite(t) ? t : undefined });
    }
  }
  return out;
}

async function applyRemote(row: RemoteRow): Promise<void> {
  const db = await getDb();
  if (row.store === "kv") {
    if (!SYNCED_KV.has(row.id)) return;
    if (row.deleted) return void (await db.delete("kv", row.id));
    let value = row.data;
    if (row.id === "settings") {
      // Keep this device's own settings (latency, mic, text size).
      const current = ((await db.get("kv", "settings"))?.value ?? {}) as Record<string, unknown>;
      const device = Object.fromEntries(DEVICE_SETTINGS.filter((k) => k in current).map((k) => [k, current[k]]));
      value = { ...(row.data as object), ...device };
    }
    await db.put("kv", { key: row.id, value });
    return;
  }
  if (row.deleted) {
    await db.delete(row.store, row.id);
    if (row.store === "recordings") {
      await db.delete("audio", row.id);
      await db.delete("syncmeta", keyOf("audio", row.id));
    }
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.put(row.store, row.data as any);
}

export async function runSync(remote: Remote, opts: { now?: () => number } = {}): Promise<SyncResult> {
  const now = opts.now ?? Date.now;
  const db = await getDb();
  const result: SyncResult = { downloaded: 0, uploaded: 0, audioUploaded: 0, audioTooLarge: [], errors: [] };

  let state = (await db.get("syncmeta", STATE_KEY)) ?? { key: STATE_KEY };
  if (state.userId !== remote.userId) {
    // First sync for this account on this device: everything here is merged into it.
    await db.clear("syncmeta");
    state = { key: STATE_KEY, userId: remote.userId };
    await db.put("syncmeta", state);
  }
  const metas = new Map<string, SyncMeta>();
  for (const m of await db.getAll("syncmeta")) if (m.key !== STATE_KEY) metas.set(m.key, m);

  // 1. What changed here since the last sync.
  const local = await readLocal();
  const changes = new Map<string, Omit<RemoteRow, "updated_at">>();
  const stamp = now();
  for (const [k, item] of local) {
    const meta = metas.get(k);
    if (meta?.hash === fingerprint(item.data)) continue;
    changes.set(k, { store: item.store, id: item.id, data: item.data, deleted: false, modified: Math.max(item.modified ?? stamp, (meta?.modified ?? 0) + 1) });
  }
  for (const [k, meta] of metas) {
    if (k.startsWith("audio:") || local.has(k) || !meta.hash) continue;
    const [store, ...rest] = k.split(":");
    changes.set(k, { store: store as SyncStore, id: rest.join(":"), data: null, deleted: true, modified: stamp });
  }

  // 2. Bring in other devices' changes; a newer local change wins.
  const rows = await remote.pull(state.cursor ?? null);
  let cursor = state.cursor;
  for (const row of rows) {
    if (!cursor || row.updated_at > cursor) cursor = row.updated_at;
    const k = keyOf(row.store, row.id);
    const mine = changes.get(k);
    if (mine && mine.modified > row.modified) continue;
    changes.delete(k);
    const hash = row.deleted ? undefined : fingerprint(shared(row.store, row.id, row.data));
    const localHash = local.has(k) ? fingerprint(local.get(k)!.data) : undefined;
    if (hash !== localHash) {
      await applyRemote(row);
      result.downloaded++;
    }
    if (row.deleted) await db.delete("syncmeta", k);
    else await db.put("syncmeta", { key: k, hash, modified: row.modified });
  }

  // 3. Send this device's changes.
  const outgoing = [...changes.values()];
  for (let i = 0; i < outgoing.length; i += 200) {
    const batch = outgoing.slice(i, i + 200);
    await remote.push(batch);
    for (const r of batch) {
      const k = keyOf(r.store, r.id);
      if (r.deleted) await db.delete("syncmeta", k);
      else await db.put("syncmeta", { key: k, hash: fingerprint(r.data), modified: r.modified });
    }
    result.uploaded += batch.length;
  }

  // 4. Audio of uploaded recordings.
  const gone = outgoing.filter((r) => r.store === "recordings" && r.deleted).map((r) => r.id);
  if (gone.length) {
    try {
      await remote.removeAudio(gone);
      for (const id of gone) await db.delete("syncmeta", keyOf("audio", id));
    } catch (e) {
      result.errors.push(`Couldn't remove deleted audio: ${message(e)}`);
    }
  }
  for (const rec of await db.getAll("recordings")) {
    if (rec.kind === "youtube") continue;
    const ak = keyOf("audio", rec.id);
    const meta = await db.get("syncmeta", ak);
    if (meta?.audioSize === rec.size) continue;
    const blob = (await db.get("audio", rec.id))?.blob;
    if (!blob) continue;
    if (blob.size > MAX_AUDIO_BYTES) {
      result.audioTooLarge.push(rec.name);
      continue;
    }
    try {
      await remote.uploadAudio(rec.id, blob);
      await db.put("syncmeta", { key: ak, audioSize: rec.size });
      result.audioUploaded++;
    } catch (e) {
      result.errors.push(`Couldn't upload the audio of "${rec.name}": ${message(e)}`);
    }
  }

  await db.put("syncmeta", { ...state, cursor });
  return result;
}

/** Fetches a recording's audio from the account when this device doesn't have it yet. */
export async function fetchMissingAudio(remote: Remote, recordingId: string): Promise<Blob | undefined> {
  const db = await getDb();
  const rec = await db.get("recordings", recordingId);
  if (!rec || rec.kind === "youtube") return undefined;
  const blob = await remote.downloadAudio(recordingId);
  if (!blob) return undefined;
  const typed = blob.type ? blob : new Blob([blob], { type: rec.mimeType });
  await db.put("audio", { id: recordingId, blob: typed });
  await db.put("syncmeta", { key: keyOf("audio", recordingId), audioSize: rec.size });
  return typed;
}

/** Forget what was synced, e.g. after the local data was wiped; the next sync re-downloads everything. */
export async function resetSyncState(): Promise<void> {
  await (await getDb()).clear("syncmeta");
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
