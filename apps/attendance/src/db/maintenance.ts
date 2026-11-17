/**
 * Test-mode-only DB maintenance: run `fn` with the append-only triggers of `tables` dropped, then
 * recreate them from their stored definition (sqlite_master), all in one transaction.
 * Used by /api/test/reset (wipe) and /api/test/tamper (simulate DB tampering, AC-29).
 */
import type Database from "better-sqlite3";
import { isTestMode } from "@/lib/test-mode";

export function withTriggersSuspended<T>(sqlite: Database.Database, tables: readonly string[], fn: () => T): T {
  if (!isTestMode()) throw new Error("withTriggersSuspended is test-mode only");
  const placeholders = tables.map(() => "?").join(",");
  const tx = sqlite.transaction(() => {
    const triggers = sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${placeholders})`)
      .all(...tables) as { name: string; sql: string }[];
    for (const t of triggers) sqlite.exec(`DROP TRIGGER "${t.name.replace(/"/g, '""')}"`);
    const out = fn();
    for (const t of triggers) sqlite.exec(t.sql);
    return out;
  });
  return tx();
}
