import { defineConfig } from "vitest/config";
import path from "node:path";

const live = process.env.LIVE_IMPORT === "1";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The live import test talks to a real website, so it only runs when asked.
    exclude: live ? ["node_modules/**"] : ["src/lib/import/live.test.ts", "node_modules/**"],
    testTimeout: 30_000,
  },
});
