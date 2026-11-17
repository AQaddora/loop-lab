/** Site + network writes shared by /api/admin/setup and /api/admin/sites (spec §1.1.2, §2.2). */
import { z } from "zod";
import type { DB } from "@/db";
import { siteNetworks, sites } from "@/db/schema";
import { audit } from "./audit";
import { randomId } from "./ids";
import { parseCidr } from "./ip";

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const SiteInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    timezone: z.string().min(1).max(64).refine(isTimeZone).default("UTC"),
    qrMode: z.enum(["rotating", "static"]).default("rotating"),
    rotationSeconds: z.number().int().min(10).max(120).default(30),
    graceWindows: z.number().int().min(0).max(2).default(1),
    maxShiftHours: z.number().int().min(1).max(48).default(16),
    networks: z.array(z.object({ cidr: z.string().max(64), label: z.string().max(100).optional() }).strict()).max(50).default([]),
  })
  .strict();
export type SiteInput = z.infer<typeof SiteInput>;

type Actor = { orgId: string; actorId: string | null; ip: string | null; now: number };

/** Validates every CIDR with parseCidr() first (throws cidr_* codes), then inserts site + networks + audit rows. */
export function createSite(db: DB, input: SiteInput, a: Actor): string {
  const cidrs = input.networks.map((n) => ({ cidr: parseCidr(n.cidr), label: n.label ?? null }));
  const id = randomId("site_");
  db.insert(sites)
    .values({
      id,
      orgId: a.orgId,
      name: input.name,
      timezone: input.timezone,
      qrMode: input.qrMode,
      rotationSeconds: input.rotationSeconds,
      graceWindows: input.graceWindows,
      maxShiftHours: input.maxShiftHours,
      createdAt: a.now,
    })
    .run();
  audit(db, { orgId: a.orgId, actorMemberId: a.actorId, action: "site.add", targetType: "site", targetId: id, detail: { ...input, networks: undefined }, ip: a.ip, at: a.now });
  for (const n of cidrs) addNetwork(db, id, n.cidr, n.label, a);
  return id;
}

export function addNetwork(db: DB, siteId: string, cidr: string, label: string | null, a: Actor): string {
  const id = randomId("net_");
  db.insert(siteNetworks).values({ id, siteId, cidr, label, createdBy: a.actorId, createdAt: a.now }).run();
  audit(db, { orgId: a.orgId, actorMemberId: a.actorId, action: "network.add", targetType: "site_network", targetId: id, detail: { siteId, cidr, label }, ip: a.ip, at: a.now });
  return id;
}
