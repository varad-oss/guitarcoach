import { expect, test } from "./test";
import { pasteSong } from "./helpers";

test("after one visit the app and the library work offline", async ({ page, context }) => {
  await pasteSong(page, { title: "Offline Song" });
  await page.goto("/");
  // Wait for the service worker to install and take control.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    return !!reg.active;
  });
  await page.reload();
  await context.setOffline(true);
  await page.goto("/songs");
  await expect(page.getByRole("list", { name: "Songs" }).getByText("Offline Song", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline").first()).toBeVisible();
  // Link import explains that it needs a connection.
  await page.goto("/add");
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await context.setOffline(false);
});
