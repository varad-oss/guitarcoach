import { expect, test } from "./test";
import { lyricsOf } from "./helpers";
import { fakeYouTube } from "./fake-youtube";

// Synthetic Ultimate Guitar-style import (invented lyrics) with everything the free page offers.
const UG_CONTENT = {
  ok: true,
  content: {
    adapterId: "ultimate-guitar",
    site: "Ultimate Guitar",
    url: "https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-chords-1",
    title: "Harbour Song",
    artist: "Test Band",
    text: "[Verse]\n[tab][ch]G[/ch]           [ch]Cadd9[/ch]\nLanterns over quiet water[/tab]\n[tab][ch]Em7[/ch]          [ch]D/F#[/ch]\nMorning settles on the pier[/tab]\n\n[Chorus]\n[tab][ch]Cadd9[/ch]         [ch]G[/ch]\nHold the rope and pull it closer[/tab]\n[tab][ch]D[/ch]              [ch]G[/ch]\nSing it softly, sing it clear[/tab]",
    format: "ug",
    meta: { capo: 1, key: "Ab", bpm: 240 },
    shapes: {
      G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3], alternates: [{ frets: [3, 5, 5, 4, 3, 3], barres: [{ fret: 3, fromString: 0, toString: 5 }] }, { frets: [3, 2, 0, 0, 3, 3] }] },
    },
    strumPatterns: [
      { id: "p1", name: "Main Pattern", slots: ["D", "D", "U", "D", "D", "U"], slotsPerBeat: 3, accents: [0], bpm: 240, source: "source-site" },
      { id: "p2", name: "Chorus - Alternative Pattern", slots: ["D", "-", "-", "D", "U", "U"], slotsPerBeat: 3, sectionKinds: ["chorus"], source: "source-site" },
    ],
    sourceMeta: {
      site: "Ultimate Guitar",
      rating: 4.86,
      votes: 55610,
      difficulty: "novice",
      author: "tester",
      views: 49000000,
      versions: [
        { url: "https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-chords-2", type: "Chords", version: 2, rating: 4.7, votes: 300, paid: false },
        { url: "https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-official-9", type: "Official", version: 1, rating: 4.8, votes: 900, paid: true },
      ],
    },
    hints: ["Imported 2 strumming patterns from the site."],
  },
};

async function importStub(page: import("@playwright/test").Page) {
  await page.route("**/api/import", (route) => route.fulfill({ json: UG_CONTENT }));
  await page.goto("/add");
  await page.getByLabel("Song link").fill(UG_CONTENT.content.url);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Check and save" })).toBeVisible();
}

test("the import preview shows strumming patterns, voicings and other versions", async ({ page }) => {
  await importStub(page);
  const also = page.getByRole("region", { name: "Also imported" });
  await expect(also).toContainText("Main Pattern");
  await expect(also).toContainText("Chorus - Alternative Pattern");
  await expect(also).toContainText(/up to 3 voicings/);
  const versions = page.getByRole("region", { name: "Other versions" });
  await expect(versions.getByRole("button", { name: "Chords ver 2" })).toBeVisible();
  await expect(versions).not.toContainText("Official");
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  // Source details and the paid version note on the song page.
  const src = page.getByRole("region", { name: "From Ultimate Guitar" });
  await expect(src).toContainText("4.86 / 5");
  await expect(src).toContainText("novice");
  await expect(src).toContainText("Official versions are sold by Ultimate Guitar and aren't imported.");
});

test("transpose, capo, simplify and the chords toggle change what is shown", async ({ page }) => {
  await importStub(page);
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  await expect(page.getByTestId("key-status")).toHaveText("Shapes in G, sounds in Ab (original key)");
  // Play in the original key without a capo: transpose +1, capo off.
  await page.getByRole("button", { name: "Transpose up" }).click();
  await page.getByRole("button", { name: "Capo down" }).click();
  await expect(page.getByTestId("key-status")).toHaveText("Shapes in Ab, sounds in Ab (original key)");
  await expect(page.locator(".sheet-chord", { hasText: /^Ab$/ }).first()).toBeVisible();
  await expect(page.locator(".sheet-chord", { hasText: /^Eb\/G$/ })).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByLabel("Simplify").check();
  await expect(page.locator(".sheet-chord", { hasText: /^Cadd9$/ })).toHaveCount(0);
  await expect(page.locator(".sheet-chord", { hasText: /^Em$/ }).first()).toBeVisible();
  await page.getByLabel("Chords", { exact: true }).uncheck();
  await expect(page.locator(".sheet-line .sheet-chord")).toHaveCount(0);
  await expect.poll(() => lyricsOf(page.locator(".sheet-line").first())).toEqual(["Lanterns over quiet water"]);
  // Preferences persist.
  await page.reload();
  await expect(page.getByLabel("Simplify")).toBeChecked();
});

test("chord voicings from the site can be browsed and chosen", async ({ page }) => {
  await importStub(page);
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  await expect(page.getByText("1/3")).toBeVisible();
  await page.getByRole("button", { name: "Next G voicing" }).click();
  await expect(page.getByText("2/3")).toBeVisible();
  await page.getByRole("button", { name: "Use this one" }).click();
  await expect(page.getByText("1/3")).toBeVisible();
  await expect(page.getByRole("img", { name: "G chord: 3 5 5 4 3 3" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: "G chord: 3 5 5 4 3 3" }).first()).toBeVisible();
});

test("the studio switches to the chorus's own strumming pattern", async ({ page }) => {
  await importStub(page);
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  const id = new URL(page.url()).searchParams.get("id");
  await page.goto(`/studio?song=${id}`);
  const current = page.getByTestId("current-pattern");
  await expect(current).toHaveText(/^Main Pattern/);
  await page.getByLabel("Count-in").uncheck();
  await page.getByTestId("play-toggle").click();
  await expect(current).toHaveText(/^Main Pattern/);
  // 240 BPM: the verse (4 bars) lasts 4 seconds, then the chorus pattern takes over.
  await expect(current).toHaveText(/^Chorus - Alternative Pattern/, { timeout: 8000 });
  await page.getByTestId("play-toggle").click();
});

test("play along with a YouTube video (YouTube's player stubbed)", async ({ page }) => {
  await fakeYouTube(page);
  await importStub(page);
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  const id = new URL(page.url()).searchParams.get("id");
  await page.getByRole("radio", { name: "Recordings & timing" }).click();
  await page.getByLabel("Or play along with a YouTube video").fill("https://youtu.be/2Vv-BfVoq4g");
  await page.getByRole("button", { name: "Add video" }).click();
  await expect(page.getByText("YouTube video, ", { exact: false })).toBeVisible();
  await expect(page.getByText("Used for practice")).toBeVisible();

  await page.goto(`/studio?song=${id}`);
  await expect(page.getByTestId("youtube-player").locator('[data-fake-youtube="2Vv-BfVoq4g"]')).toBeVisible();
  await expect(page.getByText(/timing hasn't been set/)).toBeVisible();
  await page.getByLabel("Count-in").uncheck();
  await page.getByTestId("play-toggle").click();
  await expect.poll(async () => page.getByTestId("time").textContent(), { timeout: 6000 }).not.toBe("0:00");
  await page.getByTestId("play-toggle").click();

  await page.goto(`/song?id=${id}&tab=audio`);
  await page.getByRole("link", { name: "Align timing" }).click();
  await expect(page.getByTestId("youtube-player")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automatic estimate" })).toHaveCount(0);
  await page.getByRole("button", { name: "+50 ms" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Calibrated timing", { exact: true })).toBeVisible();
});
