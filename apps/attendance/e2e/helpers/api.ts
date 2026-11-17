import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";

/** Fixture constants (spec §7.3), mirrored from src/lib/test-seed.ts. */
export const FX = {
  orgId: "org_acme",
  hq: "site_hq",
  wh: "site_wh",
  owner: "owner@acme.test",
  admin: "admin@acme.test",
  emp1: "emp1@acme.test",
  emp2: "emp2@acme.test",
  codes: { emp1: "E001", emp2: "E002" },
  stranger: "stranger@acme.test",
  gmail: "someone@gmail.com",
  ip: { inV4: "198.51.100.23", inV6: "2001:db8:10::23", out: "203.0.113.9", whIn: "192.0.2.10" },
} as const;

type Req = APIRequestContext | BrowserContext;
const rq = (r: Req): APIRequestContext => ("request" in r && typeof r.request !== "function" ? r.request : (r as APIRequestContext));

export type ResetOverrides = { org?: { allowedGoogleHd?: string | null; allowSyncedPasskeys?: boolean } };

/** Wipe every table and load the §7.3 fixture; also resets the test clock offset to 0. */
export async function reset(r: Req, overrides: ResetOverrides = {}) {
  const res = await rq(r).post("/api/test/reset", { data: overrides });
  expect(res.status(), await res.text()).toBe(200);
}

export type LoginOpts = { sub?: string; emailVerified?: boolean };

/** Sign `email` in through the test-login provider (same §2.3 policy as Google). Cookies land in `ctx`. */
export async function loginAs(ctx: BrowserContext, email: string, opts: LoginOpts = {}) {
  const res = await ctx.request.post("/api/test/login", { data: { email, ...opts } });
  const body = (await res.json()) as { ok: boolean; error?: string; url?: string };
  return { status: res.status(), ...body };
}

export async function setClock(r: Req, offsetMs: number) {
  const res = await rq(r).post("/api/test/clock", { data: { offsetMs } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { offsetMs: number; nowMs: number };
}

export async function mintQr(r: Req, siteId: string, atMs?: number) {
  const res = await rq(r).post("/api/test/qr", { data: atMs === undefined ? { siteId } : { siteId, atMs } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { token: string; url: string; window: number; expiresAtMs: number };
}

export async function sessionOf(ctx: BrowserContext) {
  const res = await ctx.request.get("/api/auth/session");
  expect(res.status()).toBe(200);
  return (await res.json()) as null | { user?: { email?: string; memberId?: string | null } };
}
