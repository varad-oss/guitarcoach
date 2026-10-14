// Renders public/icons/icon.svg to PNG app icons (run once: node scripts/make-icons.mjs).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const svg = readFileSync(path.join(root, "public/icons/icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(root, `public/icons/icon-${size}.png`), omitBackground: true });
  // Maskable variant: full-bleed background so launchers can crop to any shape.
  await page.setContent(`<html><body style="margin:0;background:#1d1f21;display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace("<svg ", `<svg width="${Math.round(size * 0.8)}" height="${Math.round(size * 0.8)}" `)}</body></html>`);
  await page.screenshot({ path: path.join(root, `public/icons/maskable-${size}.png`) });
}
await browser.close();
console.log("icons written");
