/** Append-only audit trail (spec §4 audit_log, TH-11). Every admin write calls this inside its transaction. */
import type { DB } from "@/db";
import { auditLog } from "@/db/schema";
import { randomId } from "./ids";

export type AuditAction =
  | "org.setup"
  | "org.update"
  | "member.add"
  | "member.update"
  | "site.add"
  | "site.update"
  | "network.add"
  | "network.remove"
  | "qr.static.mint"
  | "qr.static.revoke"
  | "kiosk.create"
  | "kiosk.pair"
  | "kiosk.revoke"
  | "credential.approve"
  | "credential.reject"
  | "credential.revoke"
  | "credential.counter_regression"
  | "attendance.correct";

export type AuditEntryInput = {
  orgId: string;
  actorMemberId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
  ip: string | null;
  at: number;
};

export function audit(db: DB, e: AuditEntryInput): string {
  const id = randomId("aud_");
  db.insert(auditLog)
    .values({
      id,
      orgId: e.orgId,
      actorMemberId: e.actorMemberId,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      detailJson: JSON.stringify(e.detail ?? {}),
      ip: e.ip,
      at: e.at,
    })
    .run();
  return id;
}
