/** GET /api/me/state: member, credential status (+ own pending confirmCode), punch state, ticket. */
import { headers } from "next/headers";
import { getDb } from "@/db";
import { nowMs } from "@/lib/clock";
import { json, route } from "@/lib/http";
import { meState } from "@/lib/me";
import { requireMember } from "@/lib/session";
import { readTicketId } from "@/lib/tickets";

export const GET = route(async () => {
  const m = await requireMember({ allowInvited: true });
  return json(meState(getDb(), m, readTicketId((await headers()).get("cookie")), nowMs()));
});
