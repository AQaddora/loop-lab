/**
 * POST /api/webauthn/register/verify {response} (spec §2.4): consume the challenge (member + register + the
 * cookie's ticket), live ticket + allowed IP again, verify with UV required, synced policy, store PENDING and
 * supersede an older PENDING in one transaction. The response carries the owner's confirm code.
 */
import { headers } from "next/headers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { inTx } from "@/db";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { ipAllowed } from "@/lib/ip";
import { assertIpForSite, memberWrite } from "@/lib/member-api";
import { bindTicket, readTicketId, siteCidrs } from "@/lib/tickets";
import { challengeFromClientData, confirmCode, consumeChallenge, rpConfig, verifyRegistration } from "@/lib/webauthn";

export const POST = route(async (req: Request) => {
  const c = await memberWrite(req, { requireProfile: true });
  const response = (c.body as { response?: RegistrationResponseJSON }).response;
  if (!response || typeof response !== "object" || typeof response.response?.clientDataJSON !== "string") {
    throw new AppError("bad_request");
  }
  const ticketId = readTicketId((await headers()).get("cookie"));
  const ch = consumeChallenge(c.db, { challenge: challengeFromClientData(response.response.clientDataJSON), memberId: c.member.id, purpose: "register", ticketId, nowMs: c.now });
  const ticket = bindTicket(c.db, ticketId, c.member.id, c.now);
  assertIpForSite(c.ip, siteCidrs(c.db, ticket.siteId), ipAllowed);
  const write = await verifyRegistration(c.db, {
    member: c.member,
    ticket,
    response,
    expectedChallenge: ch.challenge,
    ip: c.ip as string,
    ua: req.headers.get("user-agent"),
    nowMs: c.now,
    rp: rpConfig(),
  });
  const row = inTx(write);
  return json({ ok: true, credential: { id: row.id, status: row.status, synced: row.backupEligible }, confirmCode: confirmCode(row.credentialId, process.env.QR_SIGNING_SECRET ?? "") }, 201);
});
