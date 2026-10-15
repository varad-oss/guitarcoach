import { expect, test } from "./test";
import { liveMicTracks, useFakeMic } from "./helpers";

test("the tuner reads a plucked A string (synthetic audio) and releases the microphone afterwards", async ({ page }) => {
  await useFakeMic(page, "a-string");
  await page.goto("/tuner");
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("tuner-note")).toHaveText("A", { timeout: 20_000 });
  await expect(page.getByTestId("tuner-cents")).toHaveText(/In tune|cents/);
  expect(await liveMicTracks(page)).toBe(1);
  // Client-side navigation away from the tuner must stop the microphone.
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Home", exact: true }).click();
  await expect.poll(() => liveMicTracks(page)).toBe(0);
});
