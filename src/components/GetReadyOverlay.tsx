"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { cancelGetReady, skipGetReady, useGetReady } from "@/lib/studio/getReady";

/** Full-screen "3, 2, 1" before listening starts. Esc cancels, Enter starts now. */
export function GetReadyOverlay() {
  const ready = useGetReady();

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelGetReady();
      } else if (e.key === "Enter") {
        e.preventDefault();
        skipGetReady();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ready]);

  if (!ready) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="get-ready-label">
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <p id="get-ready-label" className="text-lg text-text-2">
          {ready.label}
        </p>
        <span key={ready.remaining} className="chord-face text-[160px] leading-none text-accent tabular animate-[getready_1s_ease-out]" aria-live="assertive" data-testid="get-ready-count">
          {ready.remaining}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={cancelGetReady}>
            Cancel
          </Button>
          <Button onClick={skipGetReady}>Start now</Button>
        </div>
      </div>
    </div>
  );
}
