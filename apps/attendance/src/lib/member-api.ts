/**
 * Employee write plumbing (spec §2.5 steps 1–3, also used by /api/profile and /api/webauthn/*):
 *   Origin + JSON -> session (unauthenticated / suspended / profile_incomplete) -> 10/min per member.
 */
import { getDb, type DB } from "@/db";
import type { Member } from "@/db/schema";
import { nowMs } from "./clock";
import { AppError } from "./errors";
import { readJson } from "./http";
import { clientIp } from "./ip";
import { assertWriteRequest } from "./origin";
import { hit, RATE_LIMITS } from "./ratelimit";
import { requireMember, type RequireOpts } from "./session";

export type MemberCtx = { db: DB; member: Member; now: number; ip: string | null; body: unknown };

export async function memberWrite(req: Request, opts: RequireOpts): Promise<MemberCtx> {
  assertWriteRequest(req);
  const member = await requireMember(opts);
  const db = getDb();
  const now = nowMs();
  const rl = hit(db, `member:${member.id}`, RATE_LIMITS.webauthn.limit, RATE_LIMITS.webauthn.windowMs, now);
  if (!rl.ok) throw new AppError("rate_limited");
  const text = await req.clone().text();
  const body = text.trim() === "" ? {} : await readJson(req);
  return { db, member, now, ip: clientIp(req.headers), body };
}

/** Step 6: the current client IP must be in the ticket site's CIDRs. */
export function assertIpForSite(ip: string | null, cidrs: string[], allowed: (ip: string, c: string[]) => boolean): void {
  if (!ip) throw new AppError("ip_unknown");
  if (!allowed(ip, cidrs)) throw new AppError("ip_not_allowed");
}
