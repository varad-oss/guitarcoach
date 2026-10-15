/** The get-ready countdown before listening starts (with the synthetic microphone). */
import { expect, test } from "./test";
import { useFakeMic } from "./helpers";

test.use({ getReadySeconds: 3 });

test.beforeEach(async ({ page }) => {
  await useFakeMic(page, "g-strums");
});

test("pressing play while listening counts down 3, 2, 1 before the click starts", async ({ page }) => {
  await page.goto("/studio?mode=rhythm-drill");
  await page.getByTestId("mic-toggle").click(); // not playing yet: no countdown needed
  await expect(page.getByTestId("mic-toggle")).toHaveText("Listening");
  await expect(page.getByTestId("get-ready-count")).toHaveCount(0);

  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("get-ready-count")).toHaveText("3");
  await expect(page.getByText("Get your guitar ready")).toBeVisible();
  await expect(page.getByTestId("get-ready-count")).toHaveText("2");
  await expect(page.getByTestId("get-ready-count")).toHaveText("1");
  await expect(page.getByTestId("get-ready-count")).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByTestId("rhythm-feedback")).toHaveText(/On time|ms (early|late)|Extra strum/, { timeout: 20_000 });
});

test("cancelling the countdown doesn't start", async ({ page }) => {
  await page.goto("/studio?mode=chord-drill");
  await page.getByRole("button", { name: "Start drill" }).click();
  await expect(page.getByTestId("get-ready-count")).toHaveText("3");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("get-ready-count")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start drill" })).toBeVisible();
  await expect(page.getByTestId("drill-target")).toHaveCount(0);

  // "Start now" skips the wait.
  await page.getByRole("button", { name: "Start drill" }).click();
  await page.getByRole("button", { name: "Start now" }).click();
  await expect(page.getByTestId("drill-target")).toBeVisible();
});
