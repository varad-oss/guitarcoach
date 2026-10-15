import { expect, test } from "./test";
import { useFakeMic } from "./helpers";

test("a blocked microphone is explained instead of failing silently", async ({ page }) => {
  await useFakeMic(page, "deny");
  await page.goto("/studio?mode=free-play");
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByRole("alert").filter({ hasText: /Microphone access is blocked/ })).toBeVisible();
  await expect(page.getByTestId("mic-toggle")).toHaveText("Listen to me");
});
