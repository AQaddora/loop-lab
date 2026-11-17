import { expect, test } from "@playwright/test";
import { FX, get, post, reset, setClock, signedIn } from "./helpers/api";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-32 kiosk rotation: a paired kiosk's QR rotates after +30 s, its data-url scans; revoke hides it once expiresAt passes", async ({ browser, request }) => {
  const T0 = Date.parse("2026-11-17T09:00:05.000Z"); // 5 s into a 30 s window
  await setClock(request, { fixedMs: T0 });
  const admin = await signedIn(browser, FX.admin);
  const created = await post(admin, "/api/admin/kiosks", { siteId: FX.hq, name: "Entrance TV" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const { pairingCode, pairUrl, kiosk } = created.body as { pairingCode: string; pairUrl: string; kiosk: { id: string } };
  expect(pairingCode).toMatch(/^[A-Z2-7]{8}$/);

  const kctx = await browser.newContext();
  await kctx.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
  const page = await kctx.newPage();
  await page.clock.install({ time: T0 });
  await page.goto(new URL(pairUrl).pathname + new URL(pairUrl).search);
  await expect(page).toHaveURL(/\/kiosk$/); // client-side router.replace: no load event
  const qr = page.locator("[data-qr]");
  await expect(qr).toBeVisible();
  const t1 = (await qr.getAttribute("data-token")) as string;
  const url1 = (await qr.getAttribute("data-url")) as string;
  expect(t1.startsWith("r.site_hq.1.")).toBe(true);
  expect(url1).toContain(`/s/${FX.hq}?t=`);
  const kc = (await kctx.cookies()).find((c) => c.name.endsWith("kiosk"));
  expect(kc?.httpOnly).toBe(true);
  expect((kc?.expires ?? 0) * 1000 - Date.now()).toBeGreaterThan(179 * 86_400_000);

  // the kiosk's data-url scans fine from a phone on the office network
  const phone = await browser.newContext();
  const scan = await phone.request.get(new URL(url1).pathname + new URL(url1).search, { headers: { "x-test-client-ip": FX.ip.inV4 }, maxRedirects: 0 });
  expect(scan.status()).toBe(303);

  // +30 s on both clocks: a new window, a new token
  await setClock(request, { fixedMs: T0 + 30_000 });
  await page.clock.fastForward(30_000);
  await expect(qr).not.toHaveAttribute("data-token", t1);
  const t2 = (await qr.getAttribute("data-token")) as string;
  expect(Number(t2.split(".")[3])).toBe(Number(t1.split(".")[3]) + 1);

  // revoke: the next poll is 401 and the QR element is gone once the last expiresAt has passed
  const tok = await get<{ expiresAt: number }>(kctx, "/api/kiosk/token");
  expect((await post(admin, `/api/admin/kiosks/${kiosk.id}/revoke`, {})).status).toBe(200);
  const after = await get(kctx, "/api/kiosk/token");
  expect(after.status).toBe(401);
  expect(after.body.error).toBe("kiosk_unauthorized");
  const pastExpiry = tok.body.expiresAt - (T0 + 30_000) + 1_000;
  await setClock(request, { fixedMs: tok.body.expiresAt + 1_000 });
  await page.clock.fastForward(pastExpiry);
  await expect(page.locator("[data-qr]")).toHaveCount(0);
  for (const c of [admin, kctx, phone]) await c.close();
});

test("AC-32 kiosk rotation: pairing or a token fetch from an outside IP -> ip_not_allowed", async ({ browser, request }) => {
  const admin = await signedIn(browser, FX.admin);
  const { pairingCode } = (await post(admin, "/api/admin/kiosks", { siteId: FX.hq, name: "Lobby" })).body as { pairingCode: string };
  const outside = await post(request, "/api/kiosk/pair", { code: pairingCode }, { headers: { "x-test-client-ip": FX.ip.out } });
  expect(outside.status).toBe(403);
  expect(outside.body.error).toBe("ip_not_allowed");
  // another office's network is outside too
  expect((await post(request, "/api/kiosk/pair", { code: pairingCode }, { headers: { "x-test-client-ip": FX.ip.whIn } })).body.error).toBe("ip_not_allowed");
  // the code survived the refused attempts and pairs from inside
  const kctx = await browser.newContext();
  const ok = await post(kctx, "/api/kiosk/pair", { code: pairingCode }, { headers: { "x-test-client-ip": FX.ip.inV6 } });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect((await get(kctx, "/api/kiosk/token", { "x-test-client-ip": FX.ip.inV4 })).status).toBe(200);
  const tokOut = await get(kctx, "/api/kiosk/token", { "x-test-client-ip": FX.ip.out });
  expect(tokOut.status).toBe(403);
  expect(tokOut.body.error).toBe("ip_not_allowed");
  for (const c of [admin, kctx]) await c.close();
});

test("AC-32 kiosk rotation: unpaired or revoked kiosk -> 401 kiosk_unauthorized; codes are one-time and expire", async ({ browser, request }) => {
  const T0 = Date.parse("2026-11-17T09:00:05.000Z");
  await setClock(request, { fixedMs: T0 });
  const unpaired = await get(request, "/api/kiosk/token", { "x-test-client-ip": FX.ip.inV4 });
  expect(unpaired.status).toBe(401);
  expect(unpaired.body.error).toBe("kiosk_unauthorized");
  const forged = await get(request, "/api/kiosk/token", { "x-test-client-ip": FX.ip.inV4, cookie: `kiosk=${"A".repeat(43)}` });
  expect(forged.body.error).toBe("kiosk_unauthorized");

  const admin = await signedIn(browser, FX.admin);
  const a = (await post(admin, "/api/admin/kiosks", { siteId: FX.hq, name: "A" })).body as { pairingCode: string; kiosk: { id: string } };
  const k1 = await browser.newContext();
  expect((await post(k1, "/api/kiosk/pair", { code: a.pairingCode }, { headers: { "x-test-client-ip": FX.ip.inV4 } })).status).toBe(200);
  // the same code again (another device)
  const k2 = await browser.newContext();
  const again = await post(k2, "/api/kiosk/pair", { code: a.pairingCode }, { headers: { "x-test-client-ip": FX.ip.inV4 } });
  expect(again.status).toBe(401);
  expect(again.body.error).toBe("kiosk_unauthorized");
  // an expired code
  const b = (await post(admin, "/api/admin/kiosks", { siteId: FX.hq, name: "B" })).body as { pairingCode: string };
  await setClock(request, { fixedMs: T0 + 10 * 60_000 + 1 });
  expect((await post(k2, "/api/kiosk/pair", { code: b.pairingCode }, { headers: { "x-test-client-ip": FX.ip.inV4 } })).body.error).toBe("kiosk_unauthorized");
  // revoke the paired one
  expect((await post(admin, `/api/admin/kiosks/${a.kiosk.id}/revoke`, {})).status).toBe(200);
  expect((await get(k1, "/api/kiosk/token", { "x-test-client-ip": FX.ip.inV4 })).body.error).toBe("kiosk_unauthorized");
  expect((await post(admin, `/api/admin/kiosks/${a.kiosk.id}/revoke`, {})).body.error).toBe("invalid_state");
  // static sites have no kiosk
  expect((await post(admin, "/api/admin/kiosks", { siteId: FX.wh, name: "C" })).body.error).toBe("bad_request");
  // audit trail
  const acts = (await get<{ entries: { action: string }[] }>(admin, `/api/admin/audit?targetId=${a.kiosk.id}`)).body.entries.map((e) => e.action).sort();
  expect(acts).toEqual(["kiosk.create", "kiosk.pair", "kiosk.revoke"]);
  for (const c of [admin, k1, k2]) await c.close();
});

test("AC-32 kiosk rotation: pairing is limited to 10/min per IP", async ({ request }) => {
  for (let i = 0; i < 10; i++) {
    const r = await post(request, "/api/kiosk/pair", { code: "AAAAAAAA" }, { headers: { "x-test-client-ip": FX.ip.inV4 } });
    expect(r.body.error).toBe("kiosk_unauthorized");
  }
  const r = await post(request, "/api/kiosk/pair", { code: "AAAAAAAA" }, { headers: { "x-test-client-ip": FX.ip.inV4 } });
  expect(r.status).toBe(429);
  expect(r.body.error).toBe("rate_limited");
});
