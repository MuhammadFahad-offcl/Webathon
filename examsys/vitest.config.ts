import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one real database, so run files one at a time.
    fileParallelism: false,
    // Generous: a round trip to the Neon region can take ~1s from the venue network.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
