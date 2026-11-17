import { expect, test, type APIResponse } from "@playwright/test";
import { FX, get, mintQr, patch, post, reset, setClock, signedIn } from "./helpers/api";

const cookieOf = (res: APIResponse, suffix: string) =>
  res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .find((v) => v.split("=")[0].endsWith(suffix));

const dataError = async (res: APIResponse) => /data-error="([a-z_]+)"/.exec(await res.text())?.[1];

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-12 valid scan: rotating QR + inside IPv4 and IPv6 -> 303 to /punch without the token + HttpOnly scan_ticket", async ({ request }) => {
  for (const ip of [FX.ip.inV4, FX.ip.inV6, `::ffff:${FX.ip.inV4}`]) {
    const qr = await mintQr(request, FX.hq);
    expect(qr.url).toContain("/s/site_hq?t=");
    const res = await request.get(qr.url, { headers: { "x-test-client-ip": ip }, maxRedirects: 0 });
    expect(res.status(), ip).toBe(303);
    const loc = res.headers()["location"];
    expect(loc).toMatch(/\/punch$/);
    expect(loc).not.toContain("t=");
    const c = cookieOf(res, "scan_ticket");
    expect(c, ip).toBeTruthy();
    expect(c).toMatch(/^scan_ticket=[A-Za-z0-9_-]{22}; /);
    expect(c).toMatch(/; HttpOnly/);
    expect(c).toMatch(/; SameSite=Lax/);
    expect(c).toMatch(/; Path=\//);
    expect(c).toMatch(/; Max-Age=300/);
  }
});

test("AC-12 valid scan: every scan mints a fresh ticket; an unknown site or a garbage token is refused", async ({ request }) => {
  const qr = await mintQr(request, FX.hq);
  const a = await request.get(qr.url, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
  const b = await request.get(qr.url, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
  expect(cookieOf(a, "scan_ticket")).not.toEqual(cookieOf(b, "scan_ticket"));
  const unknown = await request.get(`/s/site_nope?t=${encodeURIComponent(qr.token)}`, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
  expect(await dataError(unknown)).toBe("qr_invalid");
  const garbage = await request.get(`/s/site_hq?t=garbage`, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
  expect(garbage.status()).toBe(400);
  expect(await dataError(garbage)).toBe("qr_invalid");
  expect(cookieOf(garbage, "scan_ticket")).toBeUndefined();
  // HQ's token on the WH path
  const wrong = await request.get(`/s/site_wh?t=${encodeURIComponent(qr.token)}`, { headers: { "x-test-client-ip": FX.ip.whIn }, maxRedirects: 0 });
  expect(await dataError(wrong)).toBe("qr_invalid");
});

test("AC-15 static QR: accepted before TTL, qr_expired after, qr_revoked after revoke and on a DISABLED site; TTL > 30 d -> ttl_too_long", async ({ browser, request }) => {
  const admin = await signedIn(browser, FX.admin);
  const T0 = Date.parse("2026-11-17T09:00:15.000Z");
  await setClock(request, { fixedMs: T0 });

  const minted = await post(admin, `/api/admin/sites/${FX.wh}/static-qr`, { ttlSeconds: 7 * 86_400, label: "door" });
  expect(minted.status, JSON.stringify(minted.body)).toBe(201);
  const qr = (minted.body as { qr: { id: string; url: string; token: string; expiresAt: number } }).qr;
  expect(qr.token.startsWith("s.site_wh.1.")).toBe(true);
  expect(qr.expiresAt).toBe(T0 + 7 * 86_400_000); // T0 is on a whole second
  const path = new URL(qr.url).pathname + new URL(qr.url).search;
  const scan = () => request.get(path, { headers: { "x-test-client-ip": FX.ip.whIn }, maxRedirects: 0 });

  const ok = await scan();
  expect(ok.status()).toBe(303);
  expect(cookieOf(ok, "scan_ticket")).toBeTruthy();
  // the printable page renders the same URL
  const page = await admin.newPage();
  await page.goto(`/admin/sites/${FX.wh}/qr/${qr.id}`);
  await expect(page.locator("[data-url]")).toHaveAttribute("data-url", qr.url);
  await expect(page.locator("main svg")).toBeVisible();

  await setClock(request, { fixedMs: qr.expiresAt - 1 });
  expect((await scan()).status()).toBe(303);
  await setClock(request, { fixedMs: qr.expiresAt });
  const expired = await scan();
  expect(expired.status()).toBe(410);
  expect(await dataError(expired)).toBe("qr_expired");
  expect(cookieOf(expired, "scan_ticket")).toBeUndefined();

  // revoke
  await setClock(request, { fixedMs: T0 });
  const second = (await post(admin, `/api/admin/sites/${FX.wh}/static-qr`, { ttlSeconds: 3600 })).body as { qr: { id: string; url: string } };
  const p2 = new URL(second.qr.url).pathname + new URL(second.qr.url).search;
  const scan2 = () => request.get(p2, { headers: { "x-test-client-ip": FX.ip.whIn }, maxRedirects: 0 });
  expect((await scan2()).status()).toBe(303);
  expect((await post(admin, `/api/admin/static-qr/${second.qr.id}/revoke`, {})).status).toBe(200);
  expect(await dataError(await scan2())).toBe("qr_revoked");
  expect((await post(admin, `/api/admin/static-qr/${second.qr.id}/revoke`, {})).body.error).toBe("invalid_state");

  // DISABLED site
  const third = (await post(admin, `/api/admin/sites/${FX.wh}/static-qr`, { ttlSeconds: 86_400 })).body as { qr: { url: string } };
  const p3 = new URL(third.qr.url).pathname + new URL(third.qr.url).search;
  expect((await patch(admin, `/api/admin/sites/${FX.wh}`, { status: "DISABLED" })).status).toBe(200);
  const disabled = await request.get(p3, { headers: { "x-test-client-ip": FX.ip.whIn }, maxRedirects: 0 });
  expect(await dataError(disabled)).toBe("qr_revoked");
  // a key-version bump kills printed codes too
  expect((await patch(admin, `/api/admin/sites/${FX.wh}`, { status: "ACTIVE", bumpKeyVersion: true })).status).toBe(200);
  expect(await dataError(await request.get(p3, { headers: { "x-test-client-ip": FX.ip.whIn }, maxRedirects: 0 }))).toBe("qr_invalid");

  // TTL bounds
  expect((await post(admin, `/api/admin/sites/${FX.wh}/static-qr`, { ttlSeconds: 31 * 86_400 })).body.error).toBe("ttl_too_long");
  expect((await post(admin, `/api/admin/sites/${FX.wh}/static-qr`, { ttlSeconds: 30 * 86_400 })).status).toBe(201);
  expect((await post(admin, `/api/admin/sites/${FX.wh}/static-qr`, { ttlSeconds: 600 })).body.error).toBe("bad_request");
  // a rotating site has no printed codes
  expect((await post(admin, `/api/admin/sites/${FX.hq}/static-qr`, { ttlSeconds: 86_400 })).body.error).toBe("bad_request");
  const audit = await get<{ entries: { action: string }[] }>(admin, "/api/admin/audit?action=qr.static.revoke");
  expect(audit.body.entries).toHaveLength(1);
  await admin.close();
});
