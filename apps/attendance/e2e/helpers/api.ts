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

/** The app origin every state-changing request must carry (spec §2.7). */
export const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 3100}`;

type Req = APIRequestContext | BrowserContext;
const rq = (r: Req): APIRequestContext => ("request" in r && typeof r.request !== "function" ? r.request : (r as APIRequestContext));

export type ResetOverrides = {
  fixture?: "default" | "empty";
  org?: { allowedGoogleHd?: string | null; allowSyncedPasskeys?: boolean };
};

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

/** `{offsetMs}` shifts the server clock, `{fixedMs}` freezes it, `{}` clears it. A number = offsetMs. */
export async function setClock(r: Req, c: number | { offsetMs?: number; fixedMs?: number }) {
  const data = typeof c === "number" ? { offsetMs: c } : c;
  const res = await rq(r).post("/api/test/clock", { data });
  expect(res.status()).toBe(200);
  return (await res.json()) as { offsetMs?: number; fixedMs?: number; nowMs: number };
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

export type ApiResult<T = Record<string, unknown>> = { status: number; body: T & { error?: string } };

type WriteOpts = { origin?: string | null; contentType?: string; headers?: Record<string, string> };

async function send(r: Req, method: "POST" | "PATCH" | "DELETE", path: string, data: unknown, o: WriteOpts = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": o.contentType ?? "application/json", ...(o.headers ?? {}) };
  if (o.origin !== null) headers.origin = o.origin ?? BASE_URL;
  const res = await rq(r).fetch(path, {
    method,
    headers,
    data: data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status(), body };
}

/** State-changing calls send `Origin: <baseURL>` and JSON unless told otherwise (origin: null = no header). */
export const post = (r: Req, path: string, data?: unknown, o?: WriteOpts) => send(r, "POST", path, data ?? {}, o);
export const patch = (r: Req, path: string, data?: unknown, o?: WriteOpts) => send(r, "PATCH", path, data ?? {}, o);
export const del = (r: Req, path: string, o?: WriteOpts) => send(r, "DELETE", path, undefined, o);

export async function get<T = Record<string, unknown>>(r: Req, path: string, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const res = await rq(r).get(path, { headers });
  const text = await res.text();
  let body = {} as T;
  try {
    body = (text ? JSON.parse(text) : {}) as T;
  } catch {
    body = { raw: text } as T;
  }
  return { status: res.status(), body: body as T & { error?: string } };
}

/** New browser context signed in as `email` (asserts the sign-in worked). */
export async function signedIn(browser: import("@playwright/test").Browser, email: string, opts: LoginOpts = {}) {
  const ctx = await browser.newContext();
  const r = await loginAs(ctx, email, opts);
  expect(r.ok, `login ${email}: ${r.error ?? ""}`).toBe(true);
  return ctx;
}

export type AuditEntry = { action: string; targetType: string; targetId: string; actorMemberId: string | null; detail: Record<string, unknown> };

export async function auditFor(adminCtx: Req, targetId: string): Promise<AuditEntry[]> {
  const r = await get<{ entries: AuditEntry[] }>(adminCtx, `/api/admin/audit?targetId=${encodeURIComponent(targetId)}`);
  expect(r.status).toBe(200);
  return r.body.entries;
}

/** Scan a fresh rotating QR of `siteId` from `ip` inside this context (the ticket cookie lands in it). */
export async function scan(ctx: BrowserContext, siteId: string, ip: string) {
  const qr = await mintQr(ctx.request, siteId);
  const res = await ctx.request.get(qr.url, { headers: { "x-test-client-ip": ip }, maxRedirects: 0 });
  return { status: res.status(), location: res.headers()["location"] ?? null };
}

export const PROFILE = {
  "emp1@acme.test": { fullName: "Emma One", employeeCode: "E001", phone: "+1 555 0101" },
  "emp2@acme.test": { fullName: "Eli Two", employeeCode: "E002", phone: "+1 555 0102" },
} as const;

export async function onboard(ctx: BrowserContext, email: keyof typeof PROFILE) {
  const r = await post(ctx, "/api/profile", PROFILE[email]);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** A context signed in as `email`, onboarded, every request from `ip`, holding a fresh ticket for `siteId`. */
export async function employeeOnSite(browser: import("@playwright/test").Browser, email: keyof typeof PROFILE, siteId = "site_hq", ip = "198.51.100.23") {
  const ctx = await signedIn(browser, email);
  await ctx.setExtraHTTPHeaders({ "x-test-client-ip": ip });
  await onboard(ctx, email);
  expect((await scan(ctx, siteId, ip)).status).toBe(303);
  return ctx;
}

export type QueueItem = {
  id: string;
  member: { id: string; email: string };
  status: string;
  regIp: string | null;
  regUa: string | null;
  regSiteId: string | null;
  regTicketId: string | null;
  aaguid: string | null;
  synced: boolean;
  backupEligible: boolean;
  backupState: boolean;
  decisionNote: string | null;
};

export async function queue(adminCtx: Req, status?: string) {
  const r = await get<{ credentials: QueueItem[] }>(adminCtx, `/api/admin/credentials${status ? `?status=${status}` : ""}`);
  expect(r.status).toBe(200);
  return { items: r.body.credentials, raw: JSON.stringify(r.body) };
}
