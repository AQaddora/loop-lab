import { randomBytes } from "node:crypto";
import type { Handle } from "@/db";
import { attendanceEvents, auditLog, members, orgs, sites } from "@/db/schema";

export const b64url = (n: number) => randomBytes(n).toString("base64url");

/** Minimal org + site + member rows so FK-bound inserts work. */
export function seedBasics(h: Handle, at = 1_700_000_000_000) {
  h.db.insert(orgs).values({ id: "org_1", name: "Acme", createdAt: at }).run();
  h.db.insert(sites).values({ id: "site_hq", orgId: "org_1", name: "HQ", createdAt: at }).run();
  h.db
    .insert(members)
    .values({
      id: "m_emp1",
      orgId: "org_1",
      email: "emp1@acme.test",
      role: "employee",
      status: "ACTIVE",
      webauthnUserId: b64url(32),
      createdAt: at,
    })
    .run();
  return { orgId: "org_1", siteId: "site_hq", memberId: "m_emp1", at };
}

export function insertEvent(h: Handle, seq: number, kind: "IN" | "OUT" = "IN", at = 1_700_000_000_000) {
  h.db
    .insert(attendanceEvents)
    .values({
      id: `ev_${seq}`,
      orgId: "org_1",
      seq,
      memberId: "m_emp1",
      siteId: "site_hq",
      kind,
      source: "PUNCH",
      effectiveAt: at,
      recordedAt: at,
      prevHash: "0".repeat(64),
      hash: "a".repeat(64),
      ip: "198.51.100.23",
      ua: "test-ua",
    })
    .run();
}

export function insertAudit(h: Handle, id: string, at = 1_700_000_000_000) {
  h.db
    .insert(auditLog)
    .values({
      id,
      orgId: "org_1",
      actorMemberId: "m_emp1",
      action: "member.add",
      targetType: "member",
      targetId: "m_emp1",
      detailJson: "{}",
      ip: "198.51.100.23",
      at,
    })
    .run();
}
