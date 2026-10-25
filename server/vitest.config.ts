import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One database handle shared by one app instance per file; parallel forks
    // would each open the same file, which is fine read-only but wasteful.
    pool: "forks",
    testTimeout: 20_000,
  },
});
