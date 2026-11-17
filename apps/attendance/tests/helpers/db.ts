import path from "node:path";
import { openDb, runMigrations, type Handle } from "@/db";

const MIGRATIONS = path.resolve(__dirname, "../../drizzle");

/** A fresh in-memory SQLite DB with every migration applied (incl. the append-only triggers). */
export function freshDb(): Handle {
  const h = openDb(":memory:");
  runMigrations(h.db, MIGRATIONS);
  return h;
}
