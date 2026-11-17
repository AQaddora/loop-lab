/** POST /api/profile: onboarding (spec §1.3.4). INVITED members may call it; it makes them ACTIVE. */
import { parseBody } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { memberWrite } from "@/lib/member-api";
import { ProfileInput, saveProfile } from "@/lib/profile";

export const POST = route(async (req: Request) => {
  const c = await memberWrite(req, { allowInvited: true });
  const m = saveProfile(c.db, c.member, parseBody(ProfileInput, c.body), c.now);
  return json({ ok: true, status: m.status, profileCompletedAt: m.profileCompletedAt });
});
