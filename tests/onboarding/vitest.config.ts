import { defineConfig } from "vitest/config";

// Separate from the main `npm test` run on purpose: the golden prospects are
// a stage gate (like tests/cia), and fail until each pipeline stage is built.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/onboarding/**/*.test.ts"],
  },
});
