import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./worker/src/db/schema.ts",
  out: "./worker/src/db/migrations",
  dialect: "sqlite",
});
