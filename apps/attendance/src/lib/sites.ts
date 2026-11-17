/** Site + network writes shared by /api/admin/setup and /api/admin/sites (spec §1.1.2, §2.2). */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { siteNetworks, sites, type Site } from "@/db/schema";
import { AppError } from "./errors";
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

export const SitePatch = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().min(1).max(64).refine(isTimeZone).optional(),
    qrMode: z.enum(["rotating", "static"]).optional(),
    rotationSeconds: z.number().int().min(10).max(120).optional(),
    graceWindows: z.number().int().min(0).max(2).optional(),
    maxShiftHours: z.number().int().min(1).max(48).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    /** true: qr_key_version + 1, which kills every rotating and static token of the site */
    bumpKeyVersion: z.literal(true).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0);
export type SitePatch = z.infer<typeof SitePatch>;

export const NetworkInput = z.object({ cidr: z.string().max(64), label: z.string().trim().max(100).optional() }).strict();

export function getSite(db: DB, orgId: string, id: string): Site {
  const s = db.select().from(sites).where(and(eq(sites.id, id), eq(sites.orgId, orgId))).get();
  if (!s) throw new AppError("bad_request");
  return s;
}

export function siteView(db: DB, s: Site) {
  const networks = db.select().from(siteNetworks).where(eq(siteNetworks.siteId, s.id)).orderBy(asc(siteNetworks.createdAt)).all();
  return { ...s, networks: networks.map((n) => ({ id: n.id, cidr: n.cidr, label: n.label, createdAt: n.createdAt })) };
}

export function updateSite(db: DB, site: Site, patch: SitePatch, a: Actor): Site {
  const { bumpKeyVersion, ...rest } = patch;
  const change: Partial<Site> = { ...rest };
  if (bumpKeyVersion) change.qrKeyVersion = site.qrKeyVersion + 1;
  db.update(sites).set(change).where(eq(sites.id, site.id)).run();
  audit(db, { orgId: a.orgId, actorMemberId: a.actorId, action: "site.update", targetType: "site", targetId: site.id, detail: { before: { ...site }, change }, ip: a.ip, at: a.now });
  return db.select().from(sites).where(eq(sites.id, site.id)).get() as Site;
}

/** parseCidr() first (cidr_* codes); a CIDR the site already has -> bad_request. */
export function addNetworkChecked(db: DB, site: Site, input: z.infer<typeof NetworkInput>, a: Actor): string {
  const cidr = parseCidr(input.cidr);
  const dup = db.select({ id: siteNetworks.id }).from(siteNetworks).where(and(eq(siteNetworks.siteId, site.id), eq(siteNetworks.cidr, cidr))).get();
  if (dup) throw new AppError("bad_request");
  return addNetwork(db, site.id, cidr, input.label ?? null, a);
}

export function removeNetwork(db: DB, site: Site, networkId: string, a: Actor): void {
  const n = db.select().from(siteNetworks).where(and(eq(siteNetworks.id, networkId), eq(siteNetworks.siteId, site.id))).get();
  if (!n) throw new AppError("bad_request");
  db.delete(siteNetworks).where(eq(siteNetworks.id, n.id)).run();
  audit(db, { orgId: a.orgId, actorMemberId: a.actorId, action: "network.remove", targetType: "site_network", targetId: n.id, detail: { siteId: site.id, cidr: n.cidr, label: n.label }, ip: a.ip, at: a.now });
}
