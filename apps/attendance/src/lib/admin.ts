/**
 * Admin route plumbing: step order for every admin write is
 *   Origin + JSON (bad_origin / bad_request) -> session + role (unauthenticated / suspended / forbidden)
 *   -> rate limit 60/min per member (rate_limited) -> body schema (bad_request) -> the action.
 */
import type { z } from "zod";
import { getDb, type DB } from "@/db";
import type { Member } from "@/db/schema";
import { nowMs } from "./clock";
import { AppError } from "./errors";
import { readJson } from "./http";
import { clientIp } from "./ip";
import { assertWriteRequest } from "./origin";
import { hit, RATE_LIMITS } from "./ratelimit";
import { requireAdmin } from "./session";

export type AdminCtx = { db: DB; actor: Member; now: number; ip: string | null };

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError("bad_request");
  return r.data;
}

export async function adminWrite<T>(
  req: Request,
  schema: z.ZodType<T>,
  opts: { owner?: boolean } = {},
): Promise<{ ctx: AdminCtx; body: T }> {
  assertWriteRequest(req);
  const actor = await requireAdmin(opts);
  const db = getDb();
  const now = nowMs();
  const rl = hit(db, `admin:${actor.id}`, RATE_LIMITS.adminWrite.limit, RATE_LIMITS.adminWrite.windowMs, now);
  if (!rl.ok) throw new AppError("rate_limited");
  const body = parseBody(schema, await readJson(req));
  return { ctx: { db, actor, now, ip: clientIp(req.headers) }, body };
}

export async function adminRead(opts: { owner?: boolean } = {}): Promise<AdminCtx & { req?: never }> {
  const actor = await requireAdmin(opts);
  return { db: getDb(), actor, now: nowMs(), ip: null };
}
