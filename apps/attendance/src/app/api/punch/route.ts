/**
 * POST /api/punch {kind, response} — every check of spec §2.5, in this exact order:
 *   1 Origin + JSON · 2 session (ACTIVE + profile) · 3 rate limit · 4 consume the challenge (member, punch, the
 *   cookie's ticket, the body's kind) · 5 ticket (present, live, unused, bound to this member, site ACTIVE) ·
 *   6 client IP in the ticket site's CIDRs · 7 assertion with UV + counter · 8 credential belongs to the member
 *   (+ userHandle) and is APPROVED · 9–10 commitPunch() (state, ticket consume, chained event, counter, head).
 * Time is the server's only: any time field in the body or headers is ignored.
 */
import { headers } from "next/headers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getHandle } from "@/db";
import { credentials } from "@/db/schema";
import { parseBody } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { ipAllowed } from "@/lib/ip";
import { maxShiftLookup } from "@/lib/me";
import { assertIpForSite, memberWrite } from "@/lib/member-api";
import { commitPunch } from "@/lib/punch";
import { bindTicket, readTicketId, siteCidrs } from "@/lib/tickets";
import { challengeFromClientData, consumeChallenge, rpConfig, verifyAssertion } from "@/lib/webauthn";

// unknown keys (e.g. a client "recordedAt") are stripped, never used (AC-27)
const Body = z.object({
  kind: z.enum(["IN", "OUT"]),
  response: z.object({ id: z.string().min(1).max(1024), response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string() }).passthrough() }).passthrough(),
});

export const POST = route(async (req: Request) => {
  const c = await memberWrite(req, { requireProfile: true }); // 1, 2, 3
  const body = parseBody(Body, c.body);
  const response = body.response as unknown as AuthenticationResponseJSON;
  const ticketId = readTicketId((await headers()).get("cookie"));

  // 4
  const ch = consumeChallenge(c.db, { challenge: challengeFromClientData(response.response.clientDataJSON), memberId: c.member.id, purpose: "punch", ticketId, kind: body.kind, nowMs: c.now });
  // 5
  const ticket = bindTicket(c.db, ticketId, c.member.id, c.now);
  // 6
  assertIpForSite(c.ip, siteCidrs(c.db, ticket.siteId), ipAllowed);
  // 7
  const cred = c.db.select().from(credentials).where(eq(credentials.credentialId, response.id)).get();
  if (!cred) throw new AppError("assertion_invalid");
  const a = await verifyAssertion(cred, response, ch.challenge, rpConfig());
  if (a.counterRegression) {
    audit(c.db, { orgId: c.member.orgId, actorMemberId: c.member.id, action: "credential.counter_regression", targetType: "credential", targetId: cred.id, detail: { stored: cred.counter, got: a.newCounter }, ip: c.ip, at: c.now });
    throw new AppError("counter_regression");
  }
  // 8
  if (cred.memberId !== c.member.id || response.response.userHandle !== c.member.webauthnUserId) throw new AppError("credential_other_user");
  if (cred.status === "PENDING") throw new AppError("credential_pending");
  if (cred.status !== "APPROVED") throw new AppError("credential_revoked");
  // 9–10
  const ev = commitPunch(getHandle(), {
    orgId: c.member.orgId,
    memberId: c.member.id,
    siteId: ticket.siteId,
    kind: body.kind,
    ticketId: ticket.id,
    credentialRowId: cred.id,
    newCounter: a.newCounter,
    nowMs: c.now,
    ip: c.ip,
    ua: req.headers.get("user-agent"),
    chainKey: process.env.LOG_CHAIN_KEY ?? "",
    maxShiftHours: maxShiftLookup(c.db),
  });
  return json({ ok: true, event: ev, serverNow: c.now }, 201);
});
