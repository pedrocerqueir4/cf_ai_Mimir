import { defineConfig } from "vitest/config";
import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    setupFiles: [path.resolve(__dirname, "../tests/setup.ts")],
    globals: true,
    include: [path.resolve(__dirname, "../tests/**/*.test.ts")],
    pool: cloudflarePool({
      wrangler: {
        configPath: path.resolve(__dirname, "./wrangler.toml"),
      },
      miniflare: {
        d1Databases: ["DB"],
      },
    }),
  },
});
