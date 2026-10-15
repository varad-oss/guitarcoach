import { expect, test } from "./test";

test("new user sees an empty state with a clear first action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add your first song" })).toBeVisible();
  await expect(page.getByPlaceholder("Paste a song link")).toBeVisible();
  // No fabricated activity for a new user.
  await expect(page.getByText(/Recent sessions/)).toHaveCount(0);
});

test("main sections are reachable from the navigation", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  const cases: Array<[string, RegExp]> = [
    ["My Songs", /My Songs/],
    ["Add Song", /Add a song/],
    ["Practice Studio", /Practice Studio/],
    ["Progress", /Progress/],
    ["Settings", /Settings/],
    ["Home", /Add your first song/],
  ];
  for (const [link, heading] of cases) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("progress shows no statistics until something was practised", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByText("No practice recorded yet")).toBeVisible();
});
