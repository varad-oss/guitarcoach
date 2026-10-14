import { expect, test } from "@playwright/test";
import { useFakeMic } from "./helpers";

// The simulated microphone plays SYNTHETIC G-chord strums.
test("calibration records labelled takes, catches a mislabelled one, and reports recognition", async ({ page }) => {
  test.setTimeout(90_000);
  await useFakeMic(page, "g-strums");
  await page.goto("/calibrate");
  const g = page.getByTestId("cal-G");
  await g.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("Saved a take of G.")).toBeVisible({ timeout: 20_000 });
  await expect(g).toContainText("1 take");
  await g.getByRole("button", { name: "Add take" }).click();
  await expect(g).toContainText("2 takes", { timeout: 20_000 });

  // Playing G while it asks for D is caught instead of being learned as "D".
  await page.getByTestId("cal-D").getByRole("button", { name: "Record" }).click();
  await expect(page.getByText(/That sounded more like G than D/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("cal-D")).toContainText("Not recorded");

  // Keeping a deliberate mislabel makes the report show the confusion.
  await page.getByTestId("cal-D").getByRole("button", { name: "Record" }).click();
  await page.getByRole("button", { name: "Keep it anyway" }).click({ timeout: 20_000 });
  const report = page.getByTestId("calibration-report");
  await expect(report).toBeVisible();
  await expect(report.locator("tr", { hasText: /^G/ })).toContainText("%");

  // Takes persist.
  await page.reload();
  await expect(page.getByTestId("cal-G")).toContainText("2 takes");
  await expect(page.getByLabel("Use my calibration when judging chords")).toBeChecked();
});
