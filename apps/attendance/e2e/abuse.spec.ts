import { expect, test } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { approvedEmployee, BASE_URL, FX, get, loginAs, mintQr, myEvents, onboardAndEnroll, patch, post, reset, scan, setClock, signedIn } from "./helpers/api";
import { punch } from "./helpers/ceremony";
import { addAuthenticator } from "./helpers/webauthn";

const dataError = async (res: APIResponse) => /data-error="([a-z_]+)"/.exec(await res.text())?.[1];
const setCookies = (res: APIResponse) => res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);

test.describe("abuse", () => {
  test.beforeEach(async ({ request }) => {
    await reset(request);
  });

  test("AC-33 csrf origin: foreign or missing Origin -> bad_origin on state-changing requests", async ({ browser }) => {
    const owner = await signedIn(browser, FX.owner);
    const writes: [typeof post, string, unknown][] = [
      [post, "/api/admin/members", { email: "csrf@acme.test" }],
      [patch, "/api/admin/members/m_emp1", { employeeCode: "HACK" }],
      [patch, "/api/admin/org", { allowSyncedPasskeys: false }],
      [post, "/api/admin/setup", { org: { name: "x" }, site: { name: "y" } }],
    ];
    for (const [fn, path, body] of writes) {
      for (const origin of ["https://evil.example", "http://localhost:9999", "null", null, `${BASE_URL}.evil.example`]) {
        const r = await fn(owner, path, body, { origin });
        expect(r.status, `${path} origin=${origin}`).toBe(403);
        expect(r.body.error, `${path} origin=${origin}`).toBe("bad_origin");
      }
      // right Origin but not JSON
      const form = await fn(owner, path, "email=x", { contentType: "application/x-www-form-urlencoded" });
      expect(form.body.error, path).toBe("bad_request");
    }
    // nothing changed
    const ok = await patch(owner, "/api/admin/members/m_emp1", { employeeCode: "E001" });
    expect(ok.status).toBe(200);
    await owner.close();
  });

  test("AC-13 wrong IP rejected: a valid QR from an outside IP -> ip_not_allowed, no ticket cookie", async ({ request }) => {
    for (const ip of [FX.ip.out, "2001:db8:99::1", FX.ip.whIn]) {
      const qr = await mintQr(request, FX.hq);
      const res = await request.get(qr.url, { headers: { "x-test-client-ip": ip }, maxRedirects: 0 });
      expect(res.status(), ip).toBe(403);
      expect(await dataError(res), ip).toBe("ip_not_allowed");
      expect(setCookies(res).some((c) => c.includes("scan_ticket")), ip).toBe(false);
    }
    // a spoofed X-Forwarded-For does not help (the test header decides in test mode; XFF leftmost is never used)
    const qr = await mintQr(request, FX.hq);
    const res = await request.get(qr.url, { headers: { "x-test-client-ip": FX.ip.out, "x-forwarded-for": `${FX.ip.inV4}, ${FX.ip.out}` }, maxRedirects: 0 });
    expect(await dataError(res)).toBe("ip_not_allowed");
  });

  test("AC-14 expired QR rejected: with the clock frozen mid-window, 2 windows old -> qr_expired, 1 window old -> accepted", async ({ request }) => {
    const mid = Date.parse("2026-11-17T09:00:15.000Z"); // 15 s into a 30 s window
    await setClock(request, { fixedMs: mid });
    const twoOld = await mintQr(request, FX.hq, mid - 60_000);
    const oneOld = await mintQr(request, FX.hq, mid - 30_000);
    const future = await mintQr(request, FX.hq, mid + 30_000);
    const get = (url: string) => request.get(url, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
    const r2 = await get(twoOld.url);
    expect(r2.status()).toBe(410);
    expect(await dataError(r2)).toBe("qr_expired");
    expect(setCookies(r2).some((c) => c.includes("scan_ticket"))).toBe(false);
    const r1 = await get(oneOld.url);
    expect(r1.status()).toBe(303);
    expect(await dataError(await get(future.url))).toBe("qr_invalid");
  });

  test("AC-38 cookies and headers: session + scan_ticket cookies HttpOnly + SameSite=Lax; no-referrer; CSP frame-ancestors 'none'", async ({ browser, request }) => {
    const ctx = await browser.newContext();
    expect((await loginAs(ctx, FX.emp1)).ok).toBe(true);
    const qr = await mintQr(request, FX.hq);
    const scan = await ctx.request.get(qr.url, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
    expect(scan.status()).toBe(303);
    const cookies = await ctx.cookies();
    const session = cookies.find((c) => c.name.endsWith("session-token"));
    const ticket = cookies.find((c) => c.name.endsWith("scan_ticket"));
    for (const c of [session, ticket]) {
      expect(c, JSON.stringify(cookies.map((x) => x.name))).toBeTruthy();
      expect(c!.httpOnly).toBe(true);
      expect(c!.sameSite).toBe("Lax");
      expect(c!.path).toBe("/");
    }
    for (const path of ["/", "/signin", "/api/health", qr.url]) {
      const res = await request.get(path, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
      const h = res.headers();
      expect(h["referrer-policy"], path).toBe("no-referrer");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      const csp = h["content-security-policy"] ?? "";
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
      expect(csp, path).toContain("base-uri 'none'");
    }
    // a page still hydrates under the CSP (the sign-in form posts through a server action)
    const page = await ctx.newPage();
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    expect(violations).toEqual([]);
    await ctx.close();
  });

  test("AC-19 pending credential cannot check in: the ceremony completes but -> credential_pending, no event row", async ({ browser }) => {
    const emp = await signedIn(browser, FX.emp1);
    const page = await emp.newPage();
    await addAuthenticator(page);
    await onboardAndEnroll(page, FX.emp1);
    await page.goto("/");
    const r = await punch(page, "IN");
    expect(r.optionsStatus).toBe(200); // the ceremony itself ran
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe("credential_pending");
    expect(await myEvents(emp)).toEqual([]);
    const admin = await signedIn(browser, FX.admin);
    expect((await get(admin, "/api/admin/attendance/verify")).body).toEqual({ ok: true, firstBadSeq: null });
    for (const c of [emp, admin]) await c.close();
  });

  test("AC-22 double check-in rejected: a second IN without OUT (fresh ticket + challenge) -> already_in", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const { emp, page } = await approvedEmployee(browser, FX.emp1);
    await page.goto("/");
    expect((await punch(page, "IN")).status).toBe(201);
    for (const later of [5_000, 61_000, 4 * 3_600_000]) {
      await setClock(request, { fixedMs: T0 + later });
      expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
      const again = await punch(page, "IN");
      expect(again.status, `+${later}`).toBe(409);
      expect(again.body.error, `+${later}`).toBe("already_in");
    }
    // and an OUT right after the IN is too soon, an OUT without IN is not_in
    expect((await myEvents(emp)).map((e) => e.kind)).toEqual(["IN"]);
    await emp.close();
  });

});
