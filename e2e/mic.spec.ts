/**
 * Microphone tests with a SYNTHETIC Karplus–Strong G-chord recording fed in
 * through a stubbed getUserMedia (see useFakeMic). They exercise the real
 * analysis pipeline, but not a real guitar or a real microphone.
 */
import { expect, test } from "@playwright/test";
import { pasteSong, useFakeMic } from "./helpers";

test.beforeEach(async ({ page }) => {
  await useFakeMic(page, "g-strums");
});

test("free play identifies the chord coming from the microphone", async ({ page }) => {
  await page.goto("/studio?mode=free-play");
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("freeplay-chord")).toHaveText(/^G/, { timeout: 20_000 });
});

test("a practice session with listening produces a measured report", async ({ page }) => {
  const id = await pasteSong(page, {
    title: "All G",
    text: "[Verse]\nG               G\nOne long line of words\nG               G\nAnother line of words\n",
    bpm: 120,
  });
  await page.goto(`/studio?song=${id}`);
  await page.getByLabel("Count-in").uncheck();
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("live-verdict")).toBeVisible();
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("last-result")).toContainText(/G ·/, { timeout: 15_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId("finish-session").click();
  await page.waitForURL(/\/report\?id=/);
  await expect(page.getByText("Chords correct")).toBeVisible();
  await expect(page.getByText(/of \d+ judged/)).toBeVisible();
  await expect(page.getByText("Chord by chord")).toBeVisible();
  // The report must come from audio: at least one chord judged correct.
  const judged = await page.getByText(/(\d+) of (\d+) judged/).textContent();
  expect(Number(judged!.match(/(\d+) of/)![1])).toBeGreaterThan(0);

  await page.goto("/progress");
  await expect(page.getByText("All G").first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "All G" })).toBeVisible();
});

test("the rhythm drill times strums from the microphone", async ({ page }) => {
  await page.goto("/studio?mode=rhythm-drill");
  await page.getByLabel("Tempo (BPM)").fill("100");
  await page.getByTestId("mic-toggle").click();
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("rhythm-feedback")).toHaveText(/On time|ms (early|late)|Extra strum/, { timeout: 20_000 });
});
