import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Handle } from "@/db";
import { attendanceEvents, auditLog } from "@/db/schema";
import { freshDb } from "../helpers/db";
import { insertAudit, insertEvent, seedBasics } from "../helpers/fixtures";

let h: Handle;

beforeEach(() => {
  h = freshDb();
  seedBasics(h);
});

const snapshot = (table: string) => h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

describe("AC-28 append-only", () => {
  it("AC-28 append-only: UPDATE on attendance_events aborts at DB level", () => {
    insertEvent(h, 1);
    const before = snapshot("attendance_events");
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET kind = 'OUT' WHERE seq = 1").run()).toThrow(
      /append-only/,
    );
    // even "harmless" columns outside the hash cannot be rewritten
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET ip = NULL").run()).toThrow(/append-only/);
    expect(() => h.db.update(attendanceEvents).set({ effectiveAt: 1 }).where(eq(attendanceEvents.seq, 1)).run()).toThrow(
      /append-only/,
    );
    expect(snapshot("attendance_events")).toEqual(before);
  });

  it("AC-28 append-only: DELETE on attendance_events aborts at DB level", () => {
    insertEvent(h, 1);
    insertEvent(h, 2, "OUT");
    const before = snapshot("attendance_events");
    expect(() => h.sqlite.prepare("DELETE FROM attendance_events WHERE seq = 2").run()).toThrow(/append-only/);
    expect(() => h.sqlite.prepare("DELETE FROM attendance_events").run()).toThrow(/append-only/);
    expect(() => h.db.delete(attendanceEvents).run()).toThrow(/append-only/);
    expect(snapshot("attendance_events")).toEqual(before);
    expect(before).toHaveLength(2);
  });

  it("AC-28 append-only: UPDATE and DELETE on audit_log abort at DB level", () => {
    insertAudit(h, "a1");
    const before = snapshot("audit_log");
    expect(() => h.sqlite.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow(/append-only/);
    expect(() => h.db.update(auditLog).set({ detailJson: "{}" }).run()).toThrow(/append-only/);
    expect(() => h.sqlite.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
    expect(() => h.db.delete(auditLog).where(eq(auditLog.id, "a1")).run()).toThrow(/append-only/);
    expect(snapshot("audit_log")).toEqual(before);
  });

  it("AC-28 append-only: INSERT still works and the triggers exist after migrations", () => {
    insertEvent(h, 1);
    insertEvent(h, 2, "OUT");
    insertAudit(h, "a1");
    insertAudit(h, "a2");
    expect(snapshot("attendance_events")).toHaveLength(2);
    expect(snapshot("audit_log")).toHaveLength(2);
    const triggers = h.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(triggers).toEqual([
      "attendance_events_no_delete",
      "attendance_events_no_update",
      "audit_log_no_delete",
      "audit_log_no_update",
    ]);
  });
});
