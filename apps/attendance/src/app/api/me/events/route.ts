/** GET /api/me/events: the member's own events, including admin corrections and their reasons (spec §1.4.4). */
import { getDb } from "@/db";
import { memberHistory } from "@/lib/events";
import { json, route } from "@/lib/http";
import { requireMember } from "@/lib/session";

export const GET = route(async () => {
  const m = await requireMember({ allowInvited: true });
  return json({ events: memberHistory(getDb(), m.id) });
});
