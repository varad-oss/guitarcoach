import { test as base, expect } from "@playwright/test";

/**
 * All browser tests run without the get-ready countdown (it would only add
 * waiting); get-ready.spec.ts turns it back on to test it.
 */
export const test = base.extend<{ getReadySeconds: number }>({
  getReadySeconds: [0, { option: true }],
  page: async ({ page, getReadySeconds }, provide) => {
    await page.addInitScript((s) => {
      (window as { __gcGetReadySeconds?: number }).__gcGetReadySeconds = s;
    }, getReadySeconds);
    await provide(page);
  },
});

export { expect };
