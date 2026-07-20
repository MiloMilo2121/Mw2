import { defineConfig } from "vitest/config";

// Minimal test config. The suite covers the PURE alert evaluators (no I/O), so a
// plain node environment is enough — no jsdom, no path aliases required.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
