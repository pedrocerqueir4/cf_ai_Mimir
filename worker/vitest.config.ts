import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["../tests/setup.ts"],
    globals: true,
    include: ["../tests/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.toml",
        },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
