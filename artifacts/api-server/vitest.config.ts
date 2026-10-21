import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Validation can run this suite alongside the workspace-wide test command.
    // Bound CPU/DB contention so timed-out requests cannot leak into later tests.
    maxWorkers: 2,
    // Integration cases perform several real database transactions per test.
    testTimeout: 15000,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
