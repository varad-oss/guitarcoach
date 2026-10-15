/**
 * A short "get your guitar ready" countdown before anything that listens and
 * judges starts, so there's time to pick the guitar up after pressing a button.
 * One countdown at a time, shown by <GetReadyOverlay /> in the app shell.
 */

import { useSyncExternalStore } from "react";

export interface GetReadyState {
  remaining: number;
  label: string;
}

let seconds = 3;
let state: GetReadyState | null = null;
let finish: ((go: boolean) => void) | null = null;
const subscribers = new Set<() => void>();

function set(next: GetReadyState | null) {
  state = next;
  subscribers.forEach((f) => f());
}

/** From the player's settings (0 turns the countdown off). */
export function setGetReadySeconds(n: number): void {
  seconds = Math.max(0, Math.round(n));
}

function configuredSeconds(): number {
  // Browser tests can turn the wait off so they don't sit through it.
  const override = typeof window !== "undefined" ? (window as { __gcGetReadySeconds?: number }).__gcGetReadySeconds : undefined;
  return typeof override === "number" ? override : seconds;
}

/**
 * Counts down, then resolves true. Resolves false if cancelled (or replaced by
 * a newer countdown), in which case the caller should not start.
 */
export function getReady(label = "Get your guitar ready"): Promise<boolean> {
  const total = configuredSeconds();
  finish?.(false);
  if (total <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let remaining = total;
    set({ remaining, label });
    const id = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) set({ remaining, label });
      else done(true);
    }, 1000);
    const done = (go: boolean) => {
      window.clearInterval(id);
      finish = null;
      set(null);
      resolve(go);
    };
    finish = done;
  });
}

/** Cancels the countdown in progress (the action doesn't start). */
export function cancelGetReady(): void {
  finish?.(false);
}

/** Ends the countdown now and starts straight away. */
export function skipGetReady(): void {
  finish?.(true);
}

export function useGetReady(): GetReadyState | null {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => state,
    () => null,
  );
}
