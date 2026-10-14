import { expect, type Page } from "@playwright/test";

// Invented lyrics for testing.
export const SHEET = `[Verse 1]
G              C
Lanterns over quiet water
D              G
Morning settles on the pier
G              C
Gulls are circling the harbour
D              G
Every rope and sail is near

[Chorus]
Em             C
Hold the rope and pull it closer
G      D       G
Sing it softly, sing it clear
Em             C
Hold the rope and pull it closer
G      D       G
Sing it softly, sing it clear
`;

export async function pasteSong(page: Page, opts: { title: string; artist?: string; text?: string; bpm?: number }): Promise<string> {
  await page.goto("/add?method=paste");
  await page.getByLabel(/Paste a chord sheet/).fill(opts.text ?? SHEET);
  await page.getByRole("button", { name: "Read chord sheet" }).click();
  await page.getByLabel("Title").fill(opts.title);
  if (opts.artist) await page.getByLabel("Artist").fill(opts.artist);
  if (opts.bpm) await page.getByLabel("Tempo (BPM)").fill(String(opts.bpm));
  await page.getByRole("button", { name: /Save to My Songs|Save as new song/ }).click();
  await page.waitForURL(/\/song\?id=/);
  const id = new URL(page.url()).searchParams.get("id")!;
  await expect(page.getByRole("heading", { name: opts.title })).toBeVisible();
  return id;
}

/**
 * Simulated microphone. Only navigator.mediaDevices.getUserMedia is replaced:
 * it returns a live MediaStream that plays a SYNTHETIC WAV fixture through Web
 * Audio. Everything after that — the app's MediaStreamSource, capture
 * AudioWorklet, analysis Worker, chord/onset/pitch detection and UI — is the
 * real code path. (Chromium's own fake-capture flags were tried first, but they
 * still wait for the operating system's microphone permission on macOS.)
 */
export async function useFakeMic(page: Page, fixture: "g-strums" | "a-string" | "deny") {
  if (fixture !== "deny") {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const body = readFileSync(path.resolve(__dirname, `.fixtures/${fixture}.wav`));
    await page.route("**/__test-fixtures/mic.wav", (route) => route.fulfill({ body, contentType: "audio/wav" }));
  }
  await page.addInitScript((mode: string) => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    navigator.mediaDevices.getUserMedia = async () => {
      if (mode === "deny") throw new DOMException("Permission denied", "NotAllowedError");
      const ctx = new AudioContext();
      const data = await (await fetch("/__test-fixtures/mic.wav")).arrayBuffer();
      const buf = await ctx.decodeAudioData(data);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      src.start();
      const stream = dest.stream;
      for (const t of stream.getTracks()) {
        const stop = t.stop.bind(t);
        t.stop = () => {
          stop();
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
          void ctx.close();
        };
      }
      w.__streams.push(stream);
      return stream;
    };
  }, fixture);
}

export async function liveMicTracks(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length);
}

/** Lyric text of sheet lines (chord labels removed), joined per line. */
export async function lyricsOf(locator: import("@playwright/test").Locator): Promise<string[]> {
  return locator.evaluateAll((els) =>
    els.flatMap((el) => {
      const lines = el.matches(".sheet-line") ? [el] : [...el.querySelectorAll(".sheet-line")];
      return lines.map((l) => [...l.querySelectorAll(".sheet-lyric")].map((x) => x.textContent ?? "").join(""));
    }),
  );
}
