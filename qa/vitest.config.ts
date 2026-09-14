import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // API tests spawn one shared server and use a process-global in-memory rate
    // limiter, so test files must not run in parallel.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    include: ["tests/**/*.test.ts"],
    globalSetup: ["harness/globalSetup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    reporters: [
      "default",
      ["json", { outputFile: "reports/_last-run.json" }],
    ],
  },
});
