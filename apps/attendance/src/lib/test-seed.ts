/**
 * Test fixture (spec §7.3), loaded by POST /api/test/reset. Test mode only.
 */
import type { Handle } from "@/db";
import { withTriggersSuspended } from "@/db/maintenance";
import * as t from "@/db/schema";
import { randomB64url } from "./ids";
import { isTestMode } from "./test-mode";

export const FIXTURE = {
  orgId: "org_acme",
  sites: { hq: "site_hq", wh: "site_wh" },
  members: {
    owner: { id: "m_owner", email: "owner@acme.test" },
    admin: { id: "m_admin", email: "admin@acme.test" },
    emp1: { id: "m_emp1", email: "emp1@acme.test", code: "E001" },
    emp2: { id: "m_emp2", email: "emp2@acme.test", code: "E002" },
  },
  notAllowlisted: ["stranger@acme.test", "someone@gmail.com"],
  ips: { insideV4: "198.51.100.23", insideV6: "2001:db8:10::23", outside: "203.0.113.9", whInside: "192.0.2.10" },
} as const;

export type SeedOverrides = {
  /** `empty` = no org at all (bootstrap flows, AC-37, AC-42) */
  fixture?: "default" | "empty";
  /** test-only extension: org settings for the default fixture (AC-11 hd, AC-35 synced policy) */
  org?: { allowedGoogleHd?: string | null; allowSyncedPasskeys?: boolean };
};

// child tables first (foreign keys stay ON)
const WIPE_ORDER = [
  "attendance_events",
  "chain_heads",
  "audit_log",
  "webauthn_challenges",
  "scan_tickets",
  "credentials",
  "static_qr_codes",
  "kiosks",
  "site_networks",
  "rate_limits",
  "members",
  "sites",
  "orgs",
] as const;

export function resetAndSeed(h: Handle, nowMs: number, overrides: SeedOverrides = {}): void {
  if (!isTestMode()) throw new Error("resetAndSeed is test-mode only");
  withTriggersSuspended(h.sqlite, ["attendance_events", "audit_log"], () => {
    for (const table of WIPE_ORDER) h.sqlite.prepare(`DELETE FROM ${table}`).run();
    if (overrides.fixture === "empty") return;

    const { db } = h;
    db.insert(t.orgs)
      .values({
        id: FIXTURE.orgId,
        name: "Acme",
        allowedGoogleHd: overrides.org?.allowedGoogleHd ?? null,
        allowSyncedPasskeys: overrides.org?.allowSyncedPasskeys ?? true,
        createdAt: nowMs,
      })
      .run();
    db.insert(t.sites)
      .values([
        { id: FIXTURE.sites.hq, orgId: FIXTURE.orgId, name: "HQ", timezone: "UTC", qrMode: "rotating", rotationSeconds: 30, graceWindows: 1, createdAt: nowMs },
        { id: FIXTURE.sites.wh, orgId: FIXTURE.orgId, name: "Warehouse", timezone: "UTC", qrMode: "static", rotationSeconds: 30, graceWindows: 1, createdAt: nowMs },
      ])
      .run();
    db.insert(t.siteNetworks)
      .values([
        { id: "net_hq_v4", siteId: FIXTURE.sites.hq, cidr: "198.51.100.0/24", label: "HQ Wi-Fi v4", createdAt: nowMs },
        { id: "net_hq_v6", siteId: FIXTURE.sites.hq, cidr: "2001:db8:10::/48", label: "HQ Wi-Fi v6", createdAt: nowMs },
        { id: "net_wh_v4", siteId: FIXTURE.sites.wh, cidr: "192.0.2.0/24", label: "WH Wi-Fi", createdAt: nowMs },
      ])
      .run();
    const m = FIXTURE.members;
    const active = { status: "ACTIVE" as const, phone: "+10000000000", profileCompletedAt: nowMs };
    db.insert(t.members)
      .values([
        { id: m.owner.id, orgId: FIXTURE.orgId, email: m.owner.email, role: "owner", fullName: "Olivia Owner", ...active, webauthnUserId: randomB64url(32), createdAt: nowMs },
        { id: m.admin.id, orgId: FIXTURE.orgId, email: m.admin.email, role: "admin", fullName: "Adam Admin", ...active, webauthnUserId: randomB64url(32), createdAt: nowMs },
        { id: m.emp1.id, orgId: FIXTURE.orgId, email: m.emp1.email, employeeCode: m.emp1.code, role: "employee", status: "INVITED", webauthnUserId: randomB64url(32), createdAt: nowMs },
        { id: m.emp2.id, orgId: FIXTURE.orgId, email: m.emp2.email, employeeCode: m.emp2.code, role: "employee", status: "INVITED", webauthnUserId: randomB64url(32), createdAt: nowMs },
      ])
      .run();
  });
}

/** Columns /api/test/tamper may rewrite (attendance_events only). */
export const TAMPERABLE = new Set([
  "member_id",
  "site_id",
  "kind",
  "source",
  "effective_at",
  "recorded_at",
  "credential_id",
  "ticket_id",
  "corrects_seq",
  "reason",
  "actor_member_id",
  "prev_hash",
  "hash",
  "ip",
  "ua",
]);

export function tamperEvent(h: Handle, seq: number, field: string, value: string | number | null): number {
  if (!isTestMode()) throw new Error("tamperEvent is test-mode only");
  if (!TAMPERABLE.has(field)) throw new Error("field not tamperable");
  return withTriggersSuspended(h.sqlite, ["attendance_events"], () =>
    h.sqlite.prepare(`UPDATE attendance_events SET ${field} = ? WHERE seq = ?`).run(value, seq).changes,
  );
}
