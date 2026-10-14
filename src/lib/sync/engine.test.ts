import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRecording,
  clearAllData,
  deleteSong,
  getAudioBlob,
  getSettings,
  getSong,
  listSongs,
  resetDbConnection,
  saveSettings,
  saveSong,
  setAudioFallback,
  updateSong,
} from "../db/db";
import { fetchMissingAudio, runSync, type Remote, type RemoteRow } from "./engine";
import { parseChordSheet } from "../parse/chordSheet";
import { songFromParsed } from "../song/build";

/** An in-memory stand-in for the account (the Supabase table + bucket). */
class FakeAccount {
  rows = new Map<string, RemoteRow & { user: string }>();
  files = new Map<string, Blob>();
  private tick = 0;
  remote(userId: string): Remote {
    return {
      userId,
      pull: async (since) =>
        [...this.rows.values()].filter((r) => r.user === userId && (!since || r.updated_at > since)).sort((a, b) => a.updated_at.localeCompare(b.updated_at)),
      push: async (rows) => {
        for (const r of rows) this.rows.set(`${userId}/${r.store}:${r.id}`, { ...structuredClone(r), user: userId, updated_at: String(++this.tick).padStart(8, "0") });
      },
      uploadAudio: async (id, blob) => void this.files.set(`${userId}/${id}`, blob),
      downloadAudio: async (id) => this.files.get(`${userId}/${id}`) ?? null,
      removeAudio: async (ids) => ids.forEach((id) => this.files.delete(`${userId}/${id}`)),
    };
  }
}

/** Each device is its own browser profile (its own IndexedDB). */
class Device {
  private factory = new IDBFactory();
  async use() {
    await resetDbConnection();
    globalThis.indexedDB = this.factory;
  }
}

const makeSong = (title: string) =>
  songFromParsed(parseChordSheet("[Verse]\nG   C\nfloating along\n"), { title, artist: "Harbour", source: { kind: "paste", importedAt: "" } });

let account: FakeAccount;
let laptop: Device;
let phone: Device;

async function on(device: Device, user = "u1") {
  await device.use();
  return runSync(account.remote(user));
}

beforeEach(async () => {
  account = new FakeAccount();
  laptop = new Device();
  phone = new Device();
  setAudioFallback(null);
});

describe("sync between devices", () => {
  it("copies songs, edits and deletions both ways", async () => {
    await laptop.use();
    const song = await saveSong(makeSong("Paper Boats"));
    expect((await on(laptop)).uploaded).toBe(1);

    await on(phone);
    expect((await listSongs()).map((s) => s.title)).toEqual(["Paper Boats"]);
    await updateSong(song.id, (s) => ({ ...s, title: "Paper Boats (live)" }));
    await on(phone);

    const r = await on(laptop);
    expect(r.downloaded).toBe(1);
    expect((await getSong(song.id))?.title).toBe("Paper Boats (live)");

    await deleteSong(song.id);
    await on(laptop);
    await on(phone);
    expect(await listSongs()).toEqual([]);
  });

  it("does nothing when nothing changed", async () => {
    await laptop.use();
    await saveSong(makeSong("A"));
    await on(laptop);
    const again = await on(laptop);
    expect(again).toMatchObject({ uploaded: 0, downloaded: 0 });
  });

  it("keeps the newer edit when both devices changed the same song", async () => {
    await laptop.use();
    const song = await saveSong(makeSong("Original"));
    await on(laptop);
    await on(phone);

    await laptop.use();
    await saveSong({ ...song, title: "Laptop edit", updatedAt: "2026-10-15T10:00:00.000Z" });
    await phone.use();
    await saveSong({ ...song, title: "Phone edit", updatedAt: "2026-10-15T11:00:00.000Z" });

    await on(phone);
    await on(laptop); // older laptop edit loses to the phone's newer one
    expect((await getSong(song.id))?.title).toBe("Phone edit");
    await on(phone);
    expect((await getSong(song.id))?.title).toBe("Phone edit");
  });

  it("syncs settings but keeps each device's latency, mic and text size", async () => {
    await laptop.use();
    await saveSettings({ a4: 442, latencyMs: 35, fontScale: 1.2 });
    await on(laptop);
    await phone.use();
    await saveSettings({ latencyMs: 80 });
    await on(phone);
    const s = await getSettings();
    expect(s.a4).toBe(442);
    expect(s.latencyMs).toBe(80);
    expect(s.fontScale).toBe(1);
  });

  it("wiping a device doesn't delete anything from the account", async () => {
    await laptop.use();
    await saveSong(makeSong("Keep me"));
    await on(laptop);
    await clearAllData();
    await on(laptop);
    expect((await listSongs()).map((s) => s.title)).toEqual(["Keep me"]);
    expect([...account.rows.values()].filter((r) => r.deleted)).toEqual([]);
  });

  it("merges a device's existing songs into the account on first sign-in", async () => {
    await laptop.use();
    await saveSong(makeSong("From laptop"));
    await on(laptop);
    await phone.use();
    await saveSong(makeSong("Made offline on the phone"));
    await on(phone);
    expect((await listSongs()).map((s) => s.title).sort()).toEqual(["From laptop", "Made offline on the phone"]);
  });

  it("keeps accounts apart", async () => {
    await laptop.use();
    await saveSong(makeSong("Mine"));
    await on(laptop, "u1");
    await on(phone, "u2");
    expect(await listSongs()).toEqual([]);
  });

  it("uploads recording audio and downloads it on another device when first played", async () => {
    await laptop.use();
    const song = await saveSong(makeSong("With audio"));
    const rec = await addRecording({ songId: song.id, blob: new Blob([new Uint8Array(1000)], { type: "audio/mpeg" }), name: "take.mp3", durationSec: 3, bpm: 90 });
    expect((await on(laptop)).audioUploaded).toBe(1);
    expect((await on(laptop)).audioUploaded).toBe(0);

    await on(phone);
    expect(await getAudioBlob(rec.id)).toBeUndefined();
    const remote = account.remote("u1");
    setAudioFallback((id) => fetchMissingAudio(remote, id));
    const blob = await getAudioBlob(rec.id);
    expect(blob?.size).toBe(1000);
    expect(blob?.type).toBe("audio/mpeg");
    expect((await on(phone)).audioUploaded).toBe(0); // already in the account

    await deleteSong(song.id);
    await on(phone);
    expect(account.files.size).toBe(0);
  });
});
