/**
 * Signed-in state and the background sync loop. Syncs on sign-in, shortly
 * after local changes, when the connection comes back, when the app returns
 * to the foreground, and every few minutes.
 */

import { useSyncExternalStore } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { notify, onDbChange, setAudioFallback } from "../db/db";
import { fetchMissingAudio, runSync, type SyncResult } from "./engine";
import { accountsEnabled, supabase, supabaseRemote } from "./supabase";

export interface AccountState {
  enabled: boolean;
  /** False until the saved session has been read. */
  ready: boolean;
  user: { id: string; email: string | null } | null;
  status: "idle" | "syncing" | "offline" | "error";
  lastSyncedAt: number | null;
  lastResult: SyncResult | null;
  error: string | null;
}

let state: AccountState = { enabled: accountsEnabled, ready: !accountsEnabled, user: null, status: "idle", lastSyncedAt: null, lastResult: null, error: null };
const subscribers = new Set<() => void>();
function set(change: Partial<AccountState>) {
  state = { ...state, ...change };
  subscribers.forEach((f) => f());
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => state,
    () => state,
  );
}

let started = false;
let running: Promise<void> | null = null;
let again = false;
let ignoreChanges = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

/** Starts listening for sign-in and changes. Safe to call more than once. */
export function startAccount(): void {
  const sb = supabase();
  if (started || !sb) return;
  started = true;

  sb.auth.getSession().then(({ data }) => applySession(sb, data.session));
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase advises not awaiting its own calls inside this callback.
    setTimeout(() => applySession(sb, session), 0);
  });
  onDbChange(() => {
    if (ignoreChanges || !state.user) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), 3000);
  });
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  setInterval(() => void syncNow(), 5 * 60 * 1000);
}

function applySession(sb: SupabaseClient, session: Session | null) {
  const user = session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;
  const changed = user?.id !== state.user?.id;
  set({ ready: true, user });
  if (!changed) return;
  if (user) {
    const remote = supabaseRemote(sb, user.id);
    setAudioFallback((id) => fetchMissingAudio(remote, id));
    void syncNow();
  } else {
    setAudioFallback(null);
    set({ status: "idle", lastResult: null, error: null });
  }
}

/** Runs a sync now (or once more after the one in progress). */
export async function syncNow(): Promise<void> {
  const sb = supabase();
  const user = state.user;
  if (!sb || !user) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return set({ status: "offline" });
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      set({ status: "syncing" });
      try {
        const result = await runSync(supabaseRemote(sb, user.id));
        set({ status: "idle", lastSyncedAt: Date.now(), lastResult: result, error: null });
        if (result.downloaded) {
          // Refresh open views without treating our own writes as new local changes.
          ignoreChanges = true;
          notify();
          ignoreChanges = false;
        }
      } catch (e) {
        set({ status: navigator.onLine ? "error" : "offline", error: e instanceof Error ? e.message : String(e) });
      }
    } while (again && state.user?.id === user.id);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** The address the sign-in email or Google sends the player back to. */
function returnUrl() {
  return `${window.location.origin}/account`;
}

export async function sendEmailCode(email: string): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error("Accounts aren't set up on this copy of GuitarCoach.");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl(), shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error("Accounts aren't set up on this copy of GuitarCoach.");
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle(): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error("Accounts aren't set up on this copy of GuitarCoach.");
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl() } });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  // Send anything unsynced first, so signing out never loses changes.
  await syncNow().catch(() => undefined);
  await supabase()?.auth.signOut();
}
