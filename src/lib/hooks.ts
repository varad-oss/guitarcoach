"use client";

import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { getSettings, onDbChange, saveSettings } from "./db/db";
import { DEFAULT_SETTINGS, type Settings } from "./db/settings";

export type QueryState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

/**
 * Runs an IndexedDB query and re-runs it whenever stored data changes.
 * With `live: false` it runs once per change of `deps` only.
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], opts: { live?: boolean } = {}): QueryState<T> {
  const live = opts.live ?? true;
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const runQuery = useEffectEvent(() => query());
  useEffect(() => {
    let alive = true;
    const run = () =>
      runQuery()
        .then((data) => alive && setState({ status: "ready", data }))
        .catch((e: unknown) => alive && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    run();
    const off = live ? onDbChange(run) : () => {};
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useSettings(): [Settings, (change: Partial<Settings> | ((s: Settings) => Settings)) => Promise<void>, boolean] {
  const q = useLiveQuery(getSettings, []);
  const update = useCallback(async (change: Partial<Settings> | ((s: Settings) => Settings)) => {
    await saveSettings(change);
  }, []);
  return [q.status === "ready" ? q.data : DEFAULT_SETTINGS, update, q.status === "ready"];
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** requestAnimationFrame loop that calls fn every frame while active. */
export function useAnimationFrame(fn: (t: number) => void, active: boolean): void {
  const onFrame = useEffectEvent(fn);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (t: number) => {
      onFrame(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function relativeDate(iso: string | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function downloadFile(name: string, content: string | Blob, type = "application/json"): void {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(s: string): string {
  return s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "song";
}
