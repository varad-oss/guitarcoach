/**
 * README screenshots: `npm run screenshots` (after `npm run build`).
 * Stages a small library with original lyrics, plays a practice session into
 * the synthetic microphone, and saves PNGs to docs/screenshots/.
 */
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./test";
import { pasteSong, useFakeMic } from "./helpers";

test.skip(process.env.SCREENSHOTS !== "1", "Only runs with npm run screenshots");
test.setTimeout(180_000);

const OUT = path.resolve(__dirname, "../docs/screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });

const LANTERNS = `Key: G

[Verse 1]
G                Em
Paper lanterns on the river
C                D
Drifting slowly out of sight
G                Em
Every light a little promise
C                D
Carried softly through the night

[Chorus]
G                Em
Hold on, the water knows the way
C                D
Hold on, we'll find it by the day
`;

const NORTHBOUND = `Key: Am

[Verse]
Am               F
Northbound trains and empty stations
C                G
Coffee cooling in my hand
Am               F
Every mile a conversation
C                G
With a road I understand
`;

const HARBOUR = {
  ok: true,
  content: {
    adapterId: "ultimate-guitar",
    site: "Ultimate Guitar",
    url: "https://tabs.ultimate-guitar.com/tab/harbour-lights/harbour-song-chords-1",
    title: "Harbour Song",
    artist: "Harbour Lights",
    text: "[Intro]\n[tab][ch]G[/ch]   [ch]Cadd9[/ch]   [ch]Em7[/ch]   [ch]D/F#[/ch][/tab]\n\n[Verse]\n[tab][ch]G[/ch]           [ch]Cadd9[/ch]\nLanterns over quiet water[/tab]\n[tab][ch]Em7[/ch]          [ch]D/F#[/ch]\nMorning settles on the pier[/tab]\n\n[Chorus]\n[tab][ch]Cadd9[/ch]         [ch]G[/ch]\nHold the rope and pull it closer[/tab]\n[tab][ch]D[/ch]              [ch]G[/ch]\nSing it softly, sing it clear[/tab]",
    format: "ug",
    meta: { capo: 2, key: "A", bpm: 96 },
    shapes: {
      G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3], alternates: [{ frets: [3, 5, 5, 4, 3, 3], barres: [{ fret: 3, fromString: 0, toString: 5 }] }] },
      Cadd9: { frets: [null, 3, 2, 0, 3, 0], fingers: [null, 2, 1, null, 3, null] },
      Em7: { frets: [0, 2, 2, 0, 3, 0], fingers: [null, 1, 2, null, 3, null] },
      "D/F#": { frets: [2, null, 0, 2, 3, 2], fingers: [1, null, null, 2, 4, 3] },
    },
    strumPatterns: [{ id: "p1", name: "Main Pattern", slots: ["D", "-", "D", "U", "-", "U", "D", "U"], slotsPerBeat: 2, accents: [0], bpm: 96, source: "source-site" }],
    sourceMeta: { site: "Ultimate Guitar", rating: 4.8, votes: 1204, difficulty: "novice", author: "harbourfan", views: 182000 },
    hints: ["Imported 1 strumming pattern from the site."],
  },
};

async function newPage(context: BrowserContext, mic: "practice-take" | "a-string"): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as { __gcGetReadySeconds?: number }).__gcGetReadySeconds = 0;
  });
  await useFakeMic(page, mic); // eslint-disable-line react-hooks/rules-of-hooks -- a test helper, not a React hook
  return page;
}

test("README screenshots", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await newPage(context, "practice-take");

  // Library: one link import (stubbed), two pasted songs.
  await page.route("**/api/import", (route) => route.fulfill({ json: HARBOUR }));
  await page.goto("/add");
  await page.getByLabel("Song link").fill(HARBOUR.content.url);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Check and save" })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "import");
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  const harbourUrl = page.url().replace(/&saved=1/, "");

  await pasteSong(page, { title: "Northbound", artist: "The Long Platform", text: NORTHBOUND, bpm: 84 });
  const lanterns = await pasteSong(page, { title: "Paper Lanterns", artist: "River Hollow", text: LANTERNS, bpm: 100 });

  // A practice session with live feedback.
  await page.goto(`/studio?song=${lanterns}`);
  await page.getByLabel("Count-in").uncheck();
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("mic-toggle")).toHaveText("Listening");
  await page.getByTestId("play-toggle").click();
  await page.waitForTimeout(12_500);
  await shot(page, "studio");
  await page.waitForTimeout(14_000);
  await page.getByTestId("finish-session").click();
  await page.waitForURL(/\/report\?id=/);
  await page.waitForTimeout(600);
  await shot(page, "report");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Paper Lanterns" })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "home");

  await page.goto(harbourUrl);
  await expect(page.getByRole("heading", { name: "Harbour Song" })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "song");

  // Phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/song?id=${lanterns}`);
  await expect(page.getByRole("heading", { name: "Paper Lanterns" })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "phone-song");
  await page.goto(`/studio?song=${lanterns}`);
  await page.waitForTimeout(800);
  await shot(page, "phone-studio");

  // Tuner, hearing an A string.
  const tuner = await newPage(context, "a-string");
  await tuner.goto("/tuner");
  await tuner.getByTestId("mic-toggle").click();
  await tuner.waitForTimeout(3500);
  await shot(tuner, "tuner");

  await context.close();
});
