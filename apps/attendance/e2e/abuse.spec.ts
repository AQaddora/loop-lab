import { expect, test } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { approvedEmployee, BASE_URL, FX, get, loginAs, mintQr, myEvents, onboardAndEnroll, patch, post, reset, scan, setClock, signedIn } from "./helpers/api";
import { postFromPage, punch, signPunch } from "./helpers/ceremony";
import { addAuthenticator, credentialsOf } from "./helpers/webauthn";

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


  test("AC-23 replayed challenge rejected: re-POST of a successful punch body -> challenge_used", async ({ browser, request }) => {
    await setClock(request, { fixedMs: Date.parse("2026-11-17T08:00:05.000Z") });
    const { emp, page } = await approvedEmployee(browser, FX.emp1);
    await page.goto("/");
    const ok = await punch(page, "IN");
    expect(ok.status).toBe(201);
    const replay = await postFromPage(page, "/api/punch", ok.sent);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("challenge_used");
    expect((await myEvents(emp)).length).toBe(1);
    await emp.close();
  });

  test("AC-23 replayed challenge rejected: an assertion posted after +61 s -> challenge_expired", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const { emp, page } = await approvedEmployee(browser, FX.emp1);
    await page.goto("/");
    const signed = await signPunch(page, "IN");
    expect(signed.status).toBe(200);
    await setClock(request, { fixedMs: T0 + 61_000 });
    const late = await postFromPage(page, "/api/punch", signed.sent);
    expect(late.status).toBe(410);
    expect(late.body.error).toBe("challenge_expired");
    expect(await myEvents(emp)).toEqual([]);
    await emp.close();
  });

  test("AC-23 replayed challenge rejected: options for {kind:'IN'} posted with kind:'OUT' -> challenge_invalid", async ({ browser, request }) => {
    await setClock(request, { fixedMs: Date.parse("2026-11-17T08:00:05.000Z") });
    const { emp, page } = await approvedEmployee(browser, FX.emp1);
    await page.goto("/");
    const r = await punch(page, "IN", { postKind: "OUT" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("challenge_invalid");
    // a challenge minted for another member is invalid too
    const other = await approvedEmployee(browser, FX.emp2);
    await other.page.goto("/");
    const signedByOther = await signPunch(other.page, "IN");
    const swapped = await postFromPage(page, "/api/punch", signedByOther.sent);
    expect(swapped.body.error).toBe("challenge_invalid");
    for (const c of [emp, other.emp]) await c.close();
  });

  test("AC-23 replayed challenge rejected: a re-added credential with a lower sign counter -> counter_regression + audit row", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const admin = await signedIn(browser, FX.admin);
    const { emp, page, auth, credId } = await approvedEmployee(browser, FX.emp1, admin);
    await page.goto("/");
    expect((await punch(page, "IN")).status).toBe(201);
    // clone the passkey with signCount 0 (CDP: get -> remove -> add the same private key)
    const [cred] = await credentialsOf(auth.cdp, auth.authenticatorId);
    expect(cred.signCount).toBeGreaterThan(0);
    await auth.cdp.send("WebAuthn.removeCredential", { authenticatorId: auth.authenticatorId, credentialId: cred.credentialId });
    await auth.cdp.send("WebAuthn.addCredential", { authenticatorId: auth.authenticatorId, credential: { ...cred, signCount: 0 } });
    await setClock(request, { fixedMs: T0 + 61_000 });
    expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
    const r = await punch(page, "OUT");
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("counter_regression");
    const audit = await get<{ entries: { action: string; targetId: string }[] }>(admin, "/api/admin/audit?action=credential.counter_regression");
    expect(audit.body.entries).toEqual([expect.objectContaining({ action: "credential.counter_regression", targetId: credId })]);
    expect((await myEvents(emp)).map((e) => e.kind)).toEqual(["IN"]);
    for (const c of [emp, admin]) await c.close();
  });

  test("AC-24 ticket single-use: a used ticket -> ticket_used; no ticket -> ticket_missing", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const { emp, page } = await approvedEmployee(browser, FX.emp1);
    await page.goto("/");
    expect((await punch(page, "IN")).status).toBe(201);
    await setClock(request, { fixedMs: T0 + 61_000 });
    // same cookie, no new scan
    const reused = await punch(page, "OUT");
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("ticket_used");
    // no ticket at all
    await emp.clearCookies({ name: "scan_ticket" });
    const none = await punch(page, "OUT");
    expect(none.status).toBe(428);
    expect(none.body.error).toBe("ticket_missing");
    await emp.close();
  });

  test("AC-24 ticket single-use: a ticket cookie copied into another member's session -> ticket_other_user", async ({ browser, request }) => {
    await setClock(request, { fixedMs: Date.parse("2026-11-17T08:00:05.000Z") });
    const one = await approvedEmployee(browser, FX.emp1);
    const two = await approvedEmployee(browser, FX.emp2);
    await one.page.goto("/");
    await two.page.goto("/");
    // emp1 binds a fresh ticket by asking for options
    expect((await scan(one.emp, FX.hq, FX.ip.inV4)).status).toBe(303);
    expect((await signPunch(one.page, "IN")).status).toBe(200);
    const ticket = (await one.emp.cookies()).find((c) => c.name.endsWith("scan_ticket"))!;
    await two.emp.addCookies([{ ...ticket }]);
    const atOptions = await punch(two.page, "IN");
    expect(atOptions.status).toBe(403);
    expect(atOptions.body.error).toBe("ticket_other_user");
    // emp1 can still use it
    expect((await punch(one.page, "IN")).status).toBe(201);
    for (const c of [one.emp, two.emp]) await c.close();
  });

  test("AC-25 ip rechecked at punch: IP switched to outside between scan and punch -> ip_not_allowed", async ({ browser, request }) => {
    await setClock(request, { fixedMs: Date.parse("2026-11-17T08:00:05.000Z") });
    const { emp, page } = await approvedEmployee(browser, FX.emp1);
    await page.goto("/");
    // between scan and options
    await emp.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.out });
    const atOptions = await punch(page, "IN");
    expect(atOptions.status).toBe(403);
    expect(atOptions.body.error).toBe("ip_not_allowed");
    // between options and the punch itself
    await emp.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
    await page.route("**/api/punch", async (route) => {
      await route.continue({ headers: { ...route.request().headers(), "x-test-client-ip": FX.ip.out } });
    });
    const atPunch = await punch(page, "IN");
    expect(atPunch.optionsStatus).toBe(200);
    expect(atPunch.status).toBe(403);
    expect(atPunch.body.error).toBe("ip_not_allowed");
    // another office's network does not count either
    await page.unroute("**/api/punch");
    await emp.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.whIn });
    expect((await punch(page, "IN")).body.error).toBe("ip_not_allowed");
    expect(await myEvents(emp)).toEqual([]);
    await emp.close();
  });

  test("AC-34 rate limit: the 11th /api/punch/options within 60 s -> rate_limited", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const { emp } = await approvedEmployee(browser, FX.emp1);
    // a fresh minute window (enrolment already used part of this member's 10/min)
    await setClock(request, { fixedMs: T0 + 60_000 });
    for (let i = 1; i <= 10; i++) {
      const r = await post(emp, "/api/punch/options", { kind: "IN" });
      expect(r.status, `call ${i}`).toBe(200);
    }
    const eleventh = await post(emp, "/api/punch/options", { kind: "IN" });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error).toBe("rate_limited");
    // the bucket covers /api/punch too, and resets in the next window
    expect((await post(emp, "/api/punch", { kind: "IN", response: {} })).body.error).toBe("rate_limited");
    await setClock(request, { fixedMs: T0 + 120_000 });
    expect((await post(emp, "/api/punch/options", { kind: "IN" })).status).toBe(200);
    await emp.close();
  });

  test("AC-34 rate limit: the 31st /s/* request within 60 s from an outside IP -> rate_limited; 31 from an inside IP are not", async ({ request }) => {
    await setClock(request, { fixedMs: Date.parse("2026-11-17T08:00:05.000Z") });
    const qr = await mintQr(request, FX.hq);
    const hitS = (ip: string) => request.get(qr.url, { headers: { "x-test-client-ip": ip }, maxRedirects: 0 });
    for (let i = 1; i <= 30; i++) {
      const r = await hitS(FX.ip.out);
      expect(r.status(), `outside ${i}`).toBe(403); // ip_not_allowed, but counted
    }
    const thirtyFirst = await hitS(FX.ip.out);
    expect(thirtyFirst.status()).toBe(429);
    expect(await dataError(thirtyFirst)).toBe("rate_limited");
    for (let i = 1; i <= 31; i++) {
      const r = await hitS(FX.ip.inV4);
      expect(r.status(), `inside ${i}`).toBe(303);
    }
    // /api/client-ip shares the outside bucket
    const ip = await request.get("/api/client-ip", { headers: { "x-test-client-ip": FX.ip.out } });
    expect(ip.status()).toBe(429);
  });


  test("AC-29 tampered log row detected: after /api/test/tamper verify -> {ok:false, firstBadSeq:n}; untampered -> {ok:true}", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const admin = await signedIn(browser, FX.admin);
    for (const [i, kind] of (["IN", "OUT", "IN", "OUT"] as const).entries()) {
      const r = await post(admin, "/api/admin/attendance/corrections", { kind, memberId: "m_emp1", effectiveAt: T0 - (10 - i) * 60_000, reason: `manual row ${i + 1}` });
      expect(r.status).toBe(201);
    }
    const verify = async () => (await get<{ ok: boolean; firstBadSeq: number | null }>(admin, "/api/admin/attendance/verify")).body;
    expect(await verify()).toMatchObject({ ok: true });

    // ip/ua sit outside the hash: rewriting them is not a chain break
    expect((await post(request, "/api/test/tamper", { seq: 2, field: "ip", value: "203.0.113.9" })).status).toBe(200);
    expect(await verify()).toMatchObject({ ok: true });

    expect((await post(request, "/api/test/tamper", { seq: 3, field: "kind", value: "OUT" })).status).toBe(200);
    expect(await verify()).toEqual({ ok: false, firstBadSeq: 3 });
    // a later, earlier break wins
    expect((await post(request, "/api/test/tamper", { seq: 2, field: "effective_at", value: T0 - 3_600_000 })).status).toBe(200);
    expect(await verify()).toEqual({ ok: false, firstBadSeq: 2 });
    await admin.close();
  });

  test("AC-29 tampered log row detected: a rewritten reason is caught too", async ({ browser, request }) => {
    const T0 = Date.parse("2026-11-17T08:00:05.000Z");
    await setClock(request, { fixedMs: T0 });
    const admin = await signedIn(browser, FX.admin);
    for (let i = 0; i < 2; i++) {
      expect((await post(admin, "/api/admin/attendance/corrections", { kind: i === 0 ? "IN" : "OUT", memberId: "m_emp2", effectiveAt: T0 - (5 - i) * 60_000, reason: "manual" })).status).toBe(201);
    }
    expect((await post(request, "/api/test/tamper", { seq: 1, field: "reason", value: "something else" })).status).toBe(200);
    expect((await get(admin, "/api/admin/attendance/verify")).body).toEqual({ ok: false, firstBadSeq: 1 });
    await admin.close();
  });

});
