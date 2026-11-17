/**
 * POST /api/punch/options {kind} (spec §2.4, §2.5): steps 1 (Origin + JSON), 2 (session), 3 (rate limit),
 * 5 (binds the ticket) and 6 (IP). The challenge row is bound to member + `punch` + ticket + kind.
 */
import { headers } from "next/headers";
import { z } from "zod";
import { parseBody } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { ipAllowed } from "@/lib/ip";
import { assertIpForSite, memberWrite } from "@/lib/member-api";
import { bindTicket, readTicketId, siteCidrs } from "@/lib/tickets";
import { punchOptions, rpConfig, storeChallenge } from "@/lib/webauthn";

const Body = z.object({ kind: z.enum(["IN", "OUT"]) });

export const POST = route(async (req: Request) => {
  const c = await memberWrite(req, { requireProfile: true });
  const { kind } = parseBody(Body, c.body);
  const ticket = bindTicket(c.db, readTicketId((await headers()).get("cookie")), c.member.id, c.now);
  assertIpForSite(c.ip, siteCidrs(c.db, ticket.siteId), ipAllowed);
  const rp = rpConfig();
  const options = await punchOptions(rp);
  storeChallenge(c.db, { memberId: c.member.id, purpose: "punch", challenge: options.challenge, ticketId: ticket.id, kind, nowMs: c.now, ttlMs: rp.challengeTtlMs });
  return json({ options });
});
