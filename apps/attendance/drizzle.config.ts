import { mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

const file = (process.env.DATABASE_URL ?? "file:./.data/dev.db").replace(/^file:/, "");
mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: file },
});
