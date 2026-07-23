import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // `vitest bench` mode (bun run bench / bench:chat). Benchmarks live in
    // benchmarks/ and never run as part of `bun run test`.
    benchmark: {
      include: ["benchmarks/**/*.bench.?(c|m)[jt]s?(x)"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
