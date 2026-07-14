import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// UI/component tests for the FamJam web app. These render React components in a
// jsdom environment with the API client and router mocked, so they exercise the
// real gating logic (nav filtering + access-denied panels) without a live server.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
