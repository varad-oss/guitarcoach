import path from "node:path";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { lyricsOf, pasteSong } from "./helpers";

const SHEET_HTML = `<html><body style="font-family: Courier, monospace; font-size: 18px; white-space: pre; padding: 24px; background: white; color: black;">[Verse]
G              C
Lanterns over quiet water
D              G
Morning settles on the pier</body></html>`;

async function renderFixture(page: Page, kind: "pdf" | "png"): Promise<string> {
  const out = path.resolve(__dirname, `.fixtures/sheet.${kind}`);
  const p = await page.context().newPage();
  await p.setContent(SHEET_HTML);
  if (kind === "pdf") writeFileSync(out, await p.pdf({ format: "A5" }));
  else await p.screenshot({ path: out, clip: { x: 0, y: 0, width: 420, height: 170 } });
  await p.close();
  return out;
}

test("a PDF chord sheet is read on the device and flagged for checking", async ({ page }) => {
  const pdf = await renderFixture(page, "pdf");
  await page.goto("/add?method=file");
  await page.getByLabel("Choose a file to import").setInputFiles(pdf);
  await expect(page.getByRole("heading", { name: "Check and save" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Chord positions in PDFs can shift/)).toBeVisible();
  const preview = page.getByTestId("draft-preview");
  await expect.poll(() => lyricsOf(preview)).toContain("Lanterns over quiet water");
  await expect(preview.getByRole("button", { name: "Edit chord D" })).toBeVisible();
});

test("a photo of a chord sheet is read with on-device text recognition", async ({ page }) => {
  test.setTimeout(120_000);
  const png = await renderFixture(page, "png");
  await page.goto("/add?method=file");
  await page.getByLabel("Choose a file to import").setInputFiles(png);
  await expect(page.getByRole("heading", { name: "Check and save" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Text was recognised from an image/)).toBeVisible();
  const preview = page.getByTestId("draft-preview");
  await expect(preview).toContainText(/Lanterns/);
  await expect(preview.getByRole("button", { name: /Edit chord (G|C|D)/ }).first()).toBeVisible();
});

test("a recording on its own becomes a song with estimated chords", async ({ page }) => {
  await page.goto("/add?method=audio");
  await page.getByLabel("Choose an audio file").setInputFiles(path.resolve(__dirname, ".fixtures/progression-100bpm.wav"));
  await expect(page.getByText(/Estimated tempo/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/(9\d|10\d) BPM/).first()).toBeVisible();
  await expect(page.getByText("Estimated from the audio.", { exact: false })).toBeVisible();
  await page.getByLabel("Title").fill("Synthetic progression");
  await page.getByRole("button", { name: "Save song and recording" }).click();
  await page.waitForURL(/\/song\?id=/);
  await expect(page.getByText(/estimated/i).first()).toBeVisible();
  // The estimated chords should include the progression's chords.
  for (const c of ["G", "Em", "C", "D"]) await expect(page.locator(".sheet-chord", { hasText: new RegExp(`^${c}$`) }).first()).toBeVisible();
});

test("the browser-tab bookmarklet hands a page to GuitarCoach through the URL fragment", async ({ page }) => {
  const payload = {
    v: 1,
    url: "https://chords.example.org/harbour",
    title: "Harbour Song | Example Chords",
    text: "[Verse]\nG              C\nLanterns over quiet water\n",
    selection: true,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  await page.goto(`/add#gc-import=${b64}`);
  await expect(page.getByRole("heading", { name: "Check and save" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Harbour Song");
  await expect(page.getByText(/Imported from the text you selected/)).toBeVisible();
  // The fragment is cleared so a reload doesn't import twice.
  expect(new URL(page.url()).hash).toBe("");
});

test("backup and restore round-trip through a file", async ({ page }) => {
  await pasteSong(page, { title: "Backed Up Song" });
  await page.goto("/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Back up songs and history" }).click();
  const file = await (await download).path();
  // Wipe everything, then restore.
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("All data deleted.")).toBeVisible();
  await page.goto("/songs");
  await expect(page.getByText("Your library is empty")).toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("Choose a backup file").setInputFiles(file!);
  await expect(page.getByText(/Restored 1 songs/)).toBeVisible();
  await page.goto("/songs");
  await expect(page.getByRole("list", { name: "Songs" }).getByText("Backed Up Song", { exact: true })).toBeVisible();
});
