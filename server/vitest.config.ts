import { defineConfig } from "vitest/config"

export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 60000,
    testTimeout: 30000,
    pool: "forks",
    fileParallelism: false
  }
})