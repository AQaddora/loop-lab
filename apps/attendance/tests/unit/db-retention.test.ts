import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Handle } from "@/db";
import { attendanceEvents, auditLog, sites, webauthnChallenges } from "@/db/schema";
import { freshDb } from "../helpers/db";
import { insertAudit, insertEvent, seedBasics } from "../helpers/fixtures";

let h: Handle;
beforeEach(() => {
  h = freshDb();
  seedBasics(h);
});

const row = (table: string, where: string) => h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${where}`).get() as Record<string, unknown>;
const columns = (table: string) => (h.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("AC-28 append-only (retention)", () => {
  it("AC-28 append-only: UPDATE … SET ip=NULL, ua=NULL succeeds on attendance_events, the rest stays", () => {
    insertEvent(h, 1);
    const before = row("attendance_events", "seq = 1");
    expect(before.ip).toBe("198.51.100.23");
    h.sqlite.prepare("UPDATE attendance_events SET ip = NULL, ua = NULL WHERE seq = 1").run();
    const after = row("attendance_events", "seq = 1");
    expect(after.ip).toBeNull();
    expect(after.ua).toBeNull();
    expect({ ...after, ip: before.ip, ua: before.ua }).toEqual(before);
    // through drizzle too, and nulling twice is fine
    insertEvent(h, 2, "OUT");
    h.db.update(attendanceEvents).set({ ip: null }).where(eq(attendanceEvents.seq, 2)).run();
    h.db.update(attendanceEvents).set({ ip: null, ua: null }).run();
  });

  it("AC-28 append-only: setting ip or ua to a new value aborts", () => {
    insertEvent(h, 1);
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET ip = '203.0.113.9' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET ua = 'forged' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET ip = NULL, ua = 'forged' WHERE seq = 1").run()).toThrow(/append-only/);
    h.sqlite.prepare("UPDATE attendance_events SET ip = NULL WHERE seq = 1").run();
    // once purged, it cannot be refilled
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET ip = '198.51.100.23' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(row("attendance_events", "seq = 1").ip).toBeNull();
  });

  it("AC-28 append-only: every attendance_events column except ip/ua is protected (even a no-op SET)", () => {
    insertEvent(h, 1);
    const protectedCols = columns("attendance_events").filter((c) => c !== "ip" && c !== "ua");
    expect(protectedCols).toContain("hash");
    for (const c of protectedCols) {
      expect(() => h.sqlite.prepare(`UPDATE attendance_events SET ${c} = ${c}`).run(), c).toThrow(/append-only/);
    }
    // nulling ip together with a hashed column still aborts
    expect(() => h.sqlite.prepare("UPDATE attendance_events SET ip = NULL, reason = 'x'").run()).toThrow(/append-only/);
    expect(() => h.sqlite.prepare("DELETE FROM attendance_events").run()).toThrow(/append-only/);
  });

  it("AC-28 append-only: audit_log allows only ip -> NULL", () => {
    insertAudit(h, "a1");
    h.db.update(auditLog).set({ ip: null }).where(eq(auditLog.id, "a1")).run();
    expect(row("audit_log", "id = 'a1'").ip).toBeNull();
    expect(() => h.sqlite.prepare("UPDATE audit_log SET ip = '203.0.113.9'").run()).toThrow(/append-only/);
    for (const c of columns("audit_log").filter((c) => c !== "ip")) {
      expect(() => h.sqlite.prepare(`UPDATE audit_log SET ${c} = ${c}`).run(), c).toThrow(/append-only/);
    }
    expect(() => h.sqlite.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });

  it("migration 0002: sites.max_shift_hours defaults to 16 and challenges carry a kind", () => {
    expect(h.db.select().from(sites).where(eq(sites.id, "site_hq")).get()?.maxShiftHours).toBe(16);
    h.db
      .insert(webauthnChallenges)
      .values({ id: "ch1", memberId: "m_emp1", purpose: "punch", challenge: "c1", ticketId: "t1", kind: "IN", createdAt: 1, expiresAt: 2 })
      .run();
    expect(h.db.select().from(webauthnChallenges).get()?.kind).toBe("IN");
  });
});
