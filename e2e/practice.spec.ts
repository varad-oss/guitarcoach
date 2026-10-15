import path from "node:path";
import { expect, test } from "./test";
import { lyricsOf, pasteSong } from "./helpers";

test("the studio follows playback: active chord advances and the sheet scrolls", async ({ page }) => {
  const id = await pasteSong(page, { title: "Harbour Song", bpm: 120 });
  await page.goto(`/studio?song=${id}`);
  await expect(page.getByTestId("now-chord")).toHaveText("G");
  await page.getByLabel("Count-in").uncheck();
  const scroller = page.getByTestId("sheet-scroller");
  const startTop = await scroller.evaluate((el) => el.scrollTop);
  await page.getByTestId("play-toggle").click();
  // At 120 BPM each chord lasts two seconds.
  await expect(page.getByTestId("now-chord")).toHaveText("C", { timeout: 6000 });
  await expect(page.getByTestId("now-chord")).toHaveText("D", { timeout: 6000 });
  await expect.poll(() => lyricsOf(page.locator(".sheet-line[data-active=true]"))).toEqual(["Morning settles on the pier"]);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 15_000 }).toBeGreaterThan(startTop + 20);
  // Pause with the keyboard and confirm time stops.
  await page.keyboard.press("Space");
  await page.waitForTimeout(400); // the time readout refreshes every 200 ms
  const t1 = await page.getByTestId("time").textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId("time").textContent()).toBe(t1);
});

test("section loop and speed controls work", async ({ page }) => {
  const id = await pasteSong(page, { title: "Loop Song", bpm: 240 });
  await page.goto(`/studio?song=${id}`);
  await page.getByLabel("Count-in").uncheck();
  await page.getByLabel("Loop a section").selectOption({ label: "Loop Chorus" });
  await expect(page.getByTestId("now-chord")).toHaveText("Em");
  await page.getByLabel("Speed").selectOption("0.5");
  await expect(page.getByText("120", { exact: true })).toBeVisible();
  await page.getByTestId("play-toggle").click();
  // Chorus at half speed is 16 s; after the loop point it returns to Em.
  await expect(page.getByTestId("now-chord")).toHaveText("C", { timeout: 5000 });
  await page.keyboard.press("Space");
});

test("an uploaded recording is analysed and plays in the studio", async ({ page }) => {
  const id = await pasteSong(page, {
    title: "Progression",
    text: "[Verse]\n| G | Em | C | D |\n| G | Em | C | D |\n",
    bpm: 100,
  });
  await page.goto(`/song?id=${id}&tab=audio`);
  await page.getByLabel("Choose a recording to add").setInputFiles(path.resolve(__dirname, ".fixtures/progression-100bpm.wav"));
  await expect(page.getByText(/Estimated the beat \((9\d|10\d) BPM\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Estimated timing", { exact: true })).toBeVisible();
  await expect(page.getByText("Used for practice")).toBeVisible();

  await page.goto(`/studio?song=${id}`);
  await expect(page.getByText(/Timing is estimated from the audio/)).toBeVisible();
  await page.getByLabel("Count-in").uncheck();
  await page.getByTestId("play-toggle").click();
  await expect.poll(async () => page.getByTestId("time").textContent(), { timeout: 8000 }).not.toBe("0:00");
  await page.getByTestId("play-toggle").click();
});

test("align timing: tap-free manual nudge is saved and marked verified", async ({ page }) => {
  const id = await pasteSong(page, { title: "Align Me", text: "[Verse]\n| G | Em | C | D |\n", bpm: 100 });
  await page.goto(`/song?id=${id}&tab=audio`);
  await page.getByLabel("Choose a recording to add").setInputFiles(path.resolve(__dirname, ".fixtures/progression-100bpm.wav"));
  await expect(page.getByText(/Estimated the beat/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Align timing" }).click();
  await expect(page.getByRole("heading", { name: "Align timing" })).toBeVisible();
  await page.getByRole("button", { name: "+10 ms" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save as verified" }).click();
  await expect(page.getByText("Verified timing", { exact: true })).toBeVisible();
  await page.goto(`/song?id=${id}&tab=audio`);
  await expect(page.getByText("Verified timing", { exact: true })).toBeVisible();
});
