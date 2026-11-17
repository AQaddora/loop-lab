/** Employee page guard: no session -> /signin; profile not done -> /onboarding (spec AC-16). */
import { redirect } from "next/navigation";
import type { Member } from "@/db/schema";
import { withBase } from "./base-path";
import { currentMember } from "./session";

export type Guarded = { member: Member } | { blocked: "suspended" };

export async function employeePage(path: string, opts: { allowIncomplete?: boolean } = {}): Promise<Guarded> {
  const m = await currentMember();
  if (!m) redirect(withBase(`/signin?callbackUrl=${encodeURIComponent(path)}`));
  if (m.status === "SUSPENDED" || m.status === "REMOVED") return { blocked: "suspended" };
  if (!opts.allowIncomplete && (m.status === "INVITED" || m.profileCompletedAt === null)) redirect(withBase("/onboarding"));
  return { member: m };
}
