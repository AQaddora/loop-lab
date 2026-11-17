/**
 * POST /api/webauthn/register/options (spec §2.4): member ACTIVE + profile, live ticket (bound here), allowed IP.
 * The challenge row is bound to member + `register` + ticket.
 */
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { sites } from "@/db/schema";
import { json, route } from "@/lib/http";
import { ipAllowed } from "@/lib/ip";
import { assertIpForSite, memberWrite } from "@/lib/member-api";
import { bindTicket, readTicketId, siteCidrs } from "@/lib/tickets";
import { registrationOptions, rpConfig, storeChallenge } from "@/lib/webauthn";

export const POST = route(async (req: Request) => {
  const c = await memberWrite(req, { requireProfile: true });
  const ticket = bindTicket(c.db, readTicketId((await headers()).get("cookie")), c.member.id, c.now);
  assertIpForSite(c.ip, siteCidrs(c.db, ticket.siteId), ipAllowed);
  const rp = rpConfig();
  const options = await registrationOptions(c.db, c.member, rp);
  storeChallenge(c.db, { memberId: c.member.id, purpose: "register", challenge: options.challenge, ticketId: ticket.id, nowMs: c.now, ttlMs: rp.challengeTtlMs });
  const site = c.db.select({ name: sites.name }).from(sites).where(eq(sites.id, ticket.siteId)).get();
  return json({ options, site: { id: ticket.siteId, name: site?.name ?? "" } });
});
