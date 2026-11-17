import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Handle } from "@/db";
import { members, orgs } from "@/db/schema";
import { claimsFromGoogle, claimsFromTestLogin, type Claims } from "@/lib/identity";
import { evaluateSignIn } from "@/lib/signin-policy";
import { freshDb } from "../helpers/db";
import { b64url } from "../helpers/fixtures";

let h: Handle;
const NOW = 1_800_000_000_000;
const c = (email: string, extra: Partial<Claims> = {}): Claims => ({
  sub: `sub:${email}`,
  email,
  email_verified: true,
  hd: email.endsWith("@gmail.com") ? null : email.split("@")[1],
  ...extra,
});

function seed(status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED" = "INVITED", hd: string | null = null) {
  h.db.insert(orgs).values({ id: "org", name: "Acme", allowedGoogleHd: hd, createdAt: NOW }).run();
  h.db
    .insert(members)
    .values({ id: "m1", orgId: "org", email: "emp1@acme.test", role: "employee", status, webauthnUserId: b64url(32), createdAt: NOW })
    .run();
}

beforeEach(() => {
  h = freshDb();
});

describe("sign-in policy (spec §2.3)", () => {
  it("step 0: with no org only the verified bootstrap email passes", () => {
    expect(evaluateSignIn(h.db, c("owner@acme.test"), NOW, "Owner@Acme.test")).toMatchObject({ ok: true, bootstrap: true, memberId: null });
    expect(evaluateSignIn(h.db, c("owner@acme.test", { email_verified: false }), NOW, "owner@acme.test")).toEqual({ ok: false, error: "not_allowlisted" });
    expect(evaluateSignIn(h.db, c("emp1@acme.test"), NOW, "owner@acme.test")).toEqual({ ok: false, error: "not_allowlisted" });
    expect(evaluateSignIn(h.db, c("owner@acme.test"), NOW, "")).toEqual({ ok: false, error: "not_allowlisted" });
    expect(evaluateSignIn(h.db, c("owner@acme.test"), NOW, undefined)).toEqual({ ok: false, error: "not_allowlisted" });
  });

  it("step 0 is over once an org exists: the bootstrap email needs an allowlist entry", () => {
    seed();
    expect(evaluateSignIn(h.db, c("owner@acme.test"), NOW, "owner@acme.test")).toEqual({ ok: false, error: "not_allowlisted" });
  });

  it("steps 1–3 in order", () => {
    seed("INVITED", "acme.test");
    expect(evaluateSignIn(h.db, c("emp1@acme.test", { email_verified: false }), NOW)).toEqual({ ok: false, error: "email_unverified" });
    expect(evaluateSignIn(h.db, c("someone@gmail.com"), NOW)).toEqual({ ok: false, error: "domain_not_allowed" });
    expect(evaluateSignIn(h.db, c("stranger@acme.test"), NOW)).toEqual({ ok: false, error: "not_allowlisted" });
    expect(evaluateSignIn(h.db, c("emp1@acme.test", { hd: "ACME.TEST" }), NOW)).toMatchObject({ ok: true, memberId: "m1" });
  });

  it("step 3: SUSPENDED and REMOVED -> suspended", () => {
    seed("SUSPENDED");
    expect(evaluateSignIn(h.db, c("emp1@acme.test"), NOW)).toEqual({ ok: false, error: "suspended" });
    h.db.update(members).set({ status: "REMOVED" }).where(eq(members.id, "m1")).run();
    expect(evaluateSignIn(h.db, c("emp1@acme.test"), NOW)).toEqual({ ok: false, error: "suspended" });
  });

  it("step 4: first login pins google_sub; a different sub -> account_mismatch", () => {
    seed("ACTIVE");
    expect(evaluateSignIn(h.db, c("EMP1@acme.test", { sub: "A" }), NOW)).toMatchObject({ ok: true, email: "emp1@acme.test" });
    const m = h.db.select().from(members).where(eq(members.id, "m1")).get()!;
    expect(m.googleSub).toBe("A");
    expect(m.lastLoginAt).toBe(NOW);
    expect(evaluateSignIn(h.db, c("emp1@acme.test", { sub: "B" }), NOW)).toEqual({ ok: false, error: "account_mismatch" });
    expect(evaluateSignIn(h.db, c("emp1@acme.test", { sub: "A" }), NOW + 1)).toMatchObject({ ok: true });
  });

  it("rejects empty claims", () => {
    seed();
    expect(evaluateSignIn(h.db, null, NOW)).toEqual({ ok: false, error: "bad_request" });
    expect(evaluateSignIn(h.db, c("emp1@acme.test", { sub: "" }), NOW)).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("identity claims (spec §2.3)", () => {
  it("normalises Google profiles strictly", () => {
    expect(claimsFromGoogle({ sub: "1", email: "A@Acme.test", email_verified: true, hd: "acme.test" })).toEqual({
      sub: "1",
      email: "a@acme.test",
      email_verified: true,
      hd: "acme.test",
    });
    expect(claimsFromGoogle({ sub: "1", email: "a@gmail.com", email_verified: "true" })?.email_verified).toBe(false);
    expect(claimsFromGoogle({ sub: "1", email: "a@gmail.com" })?.hd).toBeNull();
    expect(claimsFromGoogle({ email: "a@acme.test", email_verified: true })).toBeNull();
    expect(claimsFromGoogle(undefined)).toBeNull();
  });

  it("test-login mirrors Google: hd = email domain unless gmail.com, emailVerified defaults to true", () => {
    expect(claimsFromTestLogin({ email: "emp1@acme.test" })).toEqual({
      sub: "test-sub:emp1@acme.test",
      email: "emp1@acme.test",
      email_verified: true,
      hd: "acme.test",
    });
    expect(claimsFromTestLogin({ email: "someone@gmail.com", sub: "x", emailVerified: "false" })).toEqual({
      sub: "x",
      email: "someone@gmail.com",
      email_verified: false,
      hd: null,
    });
    expect(claimsFromTestLogin({ email: "" })).toBeNull();
  });
});
