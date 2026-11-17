import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
export type Handle = { db: DB; sqlite: Database.Database };

/** DATABASE_URL like `file:./.data/dev.db` -> filesystem path (or `:memory:`). */
export function dbFile(url: string = process.env.DATABASE_URL ?? "file:./.data/dev.db"): string {
  return url.replace(/^file:/, "");
}

export function openDb(file: string): Handle {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  if (file !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

export function runMigrations(db: DB, folder: string = migrationsFolder()): void {
  migrate(db, { migrationsFolder: folder });
}

// One connection per server process, kept on globalThis so every route bundle shares it.
const KEY = Symbol.for("attendance.db");
type DbGlobal = typeof globalThis & { [KEY]?: Handle };

export function getHandle(): Handle {
  const g = globalThis as DbGlobal;
  if (!g[KEY]) g[KEY] = openDb(dbFile());
  return g[KEY];
}

export function getDb(): DB {
  return getHandle().db;
}

export { schema };
