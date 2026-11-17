/** Onboarding profile (spec §1.3.4): name 1–100, code must match the allowlisted one, phone 7–20 of `+0-9 -`. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { members, type Member } from "@/db/schema";
import { AppError } from "./errors";

export const ProfileInput = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    employeeCode: z.string().trim().min(1).max(32).optional(),
    phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/),
  })
  .strict();

/**
 * First onboarding: the code is required and must equal the allowlisted code (code_mismatch); INVITED -> ACTIVE.
 * Later edits change name and phone only; a code that differs from the stored one -> code_mismatch.
 */
export function saveProfile(db: DB, m: Member, input: z.infer<typeof ProfileInput>, nowMs: number): Member {
  const first = m.profileCompletedAt === null;
  if (first && input.employeeCode === undefined) throw new AppError("bad_request");
  if (input.employeeCode !== undefined) {
    if (m.employeeCode !== null && input.employeeCode !== m.employeeCode) throw new AppError("code_mismatch");
  }
  const change: Partial<Member> = { fullName: input.fullName, phone: input.phone };
  if (first) {
    change.profileCompletedAt = nowMs;
    if (m.employeeCode === null && input.employeeCode !== undefined) change.employeeCode = input.employeeCode;
    if (m.status === "INVITED") change.status = "ACTIVE";
  }
  db.update(members).set(change).where(eq(members.id, m.id)).run();
  return db.select().from(members).where(eq(members.id, m.id)).get() as Member;
}
