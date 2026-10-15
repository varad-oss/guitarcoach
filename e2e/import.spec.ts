import { expect, test } from "./test";
import { lyricsOf, pasteSong, SHEET } from "./helpers";

test("paste → preview → edit a chord → save → still there after reload", async ({ page }) => {
  await page.goto("/add?method=paste");
  await page.getByLabel(/Paste a chord sheet/).fill(SHEET);
  await page.getByRole("button", { name: "Read chord sheet" }).click();
  const preview = page.getByTestId("draft-preview");
  // Lyrics are split into chord/syllable pairs; read the lyric cells only.
  await expect.poll(() => lyricsOf(preview)).toContain("Lanterns over quiet water");
  await expect(page.getByText("2 sections")).toBeVisible();
  // Fix a chord: the first C becomes Cadd9.
  await preview.getByRole("button", { name: "Edit chord C" }).first().click();
  await page.getByLabel("Chord", { exact: true }).fill("Cadd9");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(preview.getByRole("button", { name: "Edit chord Cadd9" })).toHaveCount(1);
  await page.getByLabel("Title").fill("Harbour Song");
  await page.getByLabel("Artist").fill("Test Band");
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  await expect(page.getByText("Saved to My Songs")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbour Song" })).toBeVisible();
  await expect(page.getByText("Cadd9").first()).toBeVisible();
  await page.goto("/songs");
  await expect(page.getByRole("list", { name: "Songs" }).getByText("Harbour Song", { exact: true })).toBeVisible();
  await page.getByLabel("Search by title or artist").fill("nothing like it");
  await expect(page.getByText("No songs match.")).toBeVisible();
});

test("a link that can't be imported keeps the link and offers other ways in", async ({ page }) => {
  await page.goto("/add");
  await page.getByLabel("Song link").fill("https://example.com/songs/my-song");
  await page.getByRole("button", { name: "Import" }).click();
  const failure = page.getByTestId("import-failure");
  await expect(failure).toContainText("The song wasn't imported");
  await expect(failure).toContainText("example.com");
  for (const name of ["Paste chord sheet", "Retry import", "Upload a file", "Create manually"]) await expect(failure.getByRole("button", { name })).toBeVisible();
  await failure.getByRole("button", { name: "Paste chord sheet" }).click();
  await expect(page.getByText(/Keeping from your link: .*example\.com\/songs\/my-song/)).toBeVisible();
});

test("an Ultimate Guitar link that the site refuses keeps title and artist from the URL", async ({ page }) => {
  await page.route("**/api/import", (route) =>
    route.fulfill({
      json: {
        ok: false,
        error: {
          code: "blocked",
          message: "Ultimate Guitar didn't let GuitarCoach read this page.",
          retryable: true,
          partial: { url: "https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-chords-1", site: "Ultimate Guitar", title: "Harbour Song", artist: "Test Band" },
        },
      },
    }),
  );
  await page.goto("/add");
  await page.getByLabel("Song link").fill("https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-chords-1");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByTestId("import-failure")).toContainText("“Harbour Song” by Test Band");
  await page.getByRole("button", { name: "Create manually" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Harbour Song");
});

test("a successful link import shows an editable preview (server response stubbed)", async ({ page }) => {
  await page.route("**/api/import", (route) =>
    route.fulfill({
      json: {
        ok: true,
        content: {
          adapterId: "ultimate-guitar",
          site: "Ultimate Guitar",
          url: "https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-chords-1",
          title: "Harbour Song",
          artist: "Test Band",
          text: "[Verse]\n[tab][ch]G[/ch]          [ch]C[/ch]\nLanterns over quiet water[/tab]",
          format: "ug",
          meta: { capo: 2, key: "A", bpm: 88 },
          chordShapes: {},
          hints: [],
        },
      },
    }),
  );
  await page.goto("/add");
  await page.getByLabel("Song link").fill("https://tabs.ultimate-guitar.com/tab/test-band/harbour-song-chords-1");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Check and save" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Harbour Song");
  await expect(page.getByLabel("Capo")).toHaveValue("2");
  await expect(page.getByLabel("Tempo (BPM)")).toHaveValue("88");
  await page.getByRole("button", { name: "Save to My Songs" }).click();
  await page.waitForURL(/\/song\?id=/);
  await expect(page.getByText("Capo 2")).toBeVisible();
});

test("importing the same song again is flagged and edited songs are never overwritten", async ({ page }) => {
  const id = await pasteSong(page, { title: "Harbour Song", artist: "Test Band" });
  // Edit the saved song.
  await page.getByRole("radio", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Harbour Song");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Edited", { exact: true })).toBeVisible();

  await page.goto("/add?method=paste");
  await page.getByLabel(/Paste a chord sheet/).fill(SHEET);
  await page.getByRole("button", { name: "Read chord sheet" }).click();
  await page.getByLabel("Title").fill("Harbour Song");
  await page.getByLabel("Artist").fill("Test Band");
  await expect(page.getByText("A song with this title is already in your library")).toBeVisible();
  await expect(page.getByText(/won't be replaced/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update existing" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open existing" }).click();
  await expect(page).toHaveURL(new RegExp(id));
});
