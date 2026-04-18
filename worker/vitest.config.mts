import { defineConfig } from "vitest/config";
import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Virtual module: cloudflare:test ─────────────────────────────────────────
// The upstream `cloudflareTest` Vite plugin (v0.14.0) sets
// `config.test.server.deps.inline = true`, which forces Vite to pre-bundle
// every node_modules dep. That breaks existing integration tests that import
// `hono`/`better-auth` through the module-fallback path provided by
// `cloudflarePool` (tracked by the `Cannot find package 'hono' imported …`
// error surfaced from miniflare).
//
// We keep `cloudflarePool` as the runtime runner (preserves module-fallback
// behaviour) and register `cloudflare:test` ourselves: it's a thin
// re-export from the pool-provided `cloudflare:test-internal` — which is
// externalised by the fallback path at runtime. This is a narrow, explicit
// implementation of what `cloudflareTest` would do, minus the inline deps.
const CLOUDFLARE_TEST_ID = "\0cloudflare:test-virtual";
const cloudflareTestBridgePath = path.resolve(
  __dirname,
  "../node_modules/@cloudflare/vitest-pool-workers/dist/worker/lib/cloudflare/test.mjs",
);

function cloudflareTestVirtual() {
  return {
    name: "mimir/cloudflare-test-virtual",
    resolveId(id: string) {
      if (id === "cloudflare:test") return CLOUDFLARE_TEST_ID;
      return null;
    },
    load(id: string) {
      if (id === CLOUDFLARE_TEST_ID) {
        // The upstream bridge re-exports everything from cloudflare:test-internal
        // (SELF, runInDurableObject, runDurableObjectAlarm, env, …).
        return fs.readFileSync(cloudflareTestBridgePath, "utf8");
      }
      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [cloudflareTestVirtual()],
  test: {
    setupFiles: [path.resolve(__dirname, "../tests/setup.ts")],
    globals: true,
    include: [path.resolve(__dirname, "../tests/**/*.test.ts")],
    // Run test files sequentially. vitest-pool-workers spins up one
    // miniflare instance per file running in parallel by default; for
    // Durable Object tests that share `env.BATTLE_ROOM` namespace (by
    // design — same battleId → same DO instance) the cold-start races
    // between concurrent DOs produce flaky results. Serial runs finish
    // in ~28s for the full battle suite, well under the 90s budget.
    fileParallelism: false,
    pool: cloudflarePool({
      wrangler: {
        configPath: path.resolve(__dirname, "./wrangler.jsonc"),
      },
      miniflare: {
        d1Databases: ["DB"],
      },
    }),
  },
});
