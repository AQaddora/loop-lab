import { expect, test } from "@playwright/test";
import { register, postFromPage } from "./helpers/ceremony";
import { employeeOnSite, FX, get, onboard, patch, post, PROFILE, queue, reset, scan, setClock, signedIn } from "./helpers/api";
import { addAuthenticator, removeAuthenticator } from "./helpers/webauthn";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-16 onboarding: /enroll and /punch before onboarding redirect to /onboarding", async ({ browser }) => {
  const ctx = await signedIn(browser, FX.emp1);
  const page = await ctx.newPage();
  await page.goto("/enroll");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/punch");
  await expect(page).toHaveURL(/\/onboarding$/);
  // INVITED members get profile_incomplete from the passkey API
  expect((await post(ctx, "/api/webauthn/register/options", {})).body.error).toBe("profile_incomplete");
  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  await p2.goto("/enroll");
  await expect(p2).toHaveURL(/\/signin\?callbackUrl=%2Fenroll$/);
  for (const c of [ctx, anon]) await c.close();
});

test("AC-16 onboarding: requires name, phone and code; wrong code -> code_mismatch", async ({ browser, request }) => {
  const ctx = await signedIn(browser, FX.emp1);
  const good = PROFILE[FX.emp1];
  for (const bad of [{ ...good, fullName: "" }, { employeeCode: good.employeeCode, phone: good.phone }, { fullName: good.fullName, employeeCode: good.employeeCode }, { fullName: good.fullName, phone: good.phone }, { ...good, phone: "12" }, { ...good, phone: "call me maybe" }, { ...good, fullName: "x".repeat(101) }]) {
    const r = await post(ctx, "/api/profile", bad);
    expect(r.status, JSON.stringify(bad)).toBe(400);
    expect(r.body.error).toBe("bad_request");
  }
  const wrong = await post(ctx, "/api/profile", { ...good, employeeCode: "E002" });
  expect(wrong.status).toBe(400); // spec §5.3: code_mismatch is a 400
  expect(wrong.body.error).toBe("code_mismatch");
  const st = await get<{ member: { status: string } }>(ctx, "/api/me/state");
  expect(st.body.member.status).toBe("INVITED");

  // /api/profile is limited to 10/min per member (spec §2.7): continue in the next window
  await setClock(request, 61_000);
  const ok = await post(ctx, "/api/profile", good);
  expect(ok.status).toBe(200);
  expect(ok.body).toMatchObject({ status: "ACTIVE" });
  // later edits: name and phone, never the code
  expect((await post(ctx, "/api/profile", { fullName: "Emma O.", phone: "+1 555 0199" })).status).toBe(200);
  expect((await post(ctx, "/api/profile", { fullName: "Emma O.", phone: "+1 555 0199", employeeCode: "E777" })).body.error).toBe("code_mismatch");
  const page = await ctx.newPage();
  await page.goto("/enroll");
  await expect(page).toHaveURL(/\/enroll$/);
  await ctx.close();
});

test("AC-16 onboarding: the onboarding form makes the member ACTIVE and moves on to /enroll", async ({ browser }) => {
  const ctx = await signedIn(browser, FX.emp2);
  const page = await ctx.newPage();
  await page.goto("/onboarding");
  await page.getByLabel("Full name").fill(PROFILE[FX.emp2].fullName);
  await page.getByLabel("Employee code").fill("WRONG");
  await page.getByLabel("Phone").fill(PROFILE[FX.emp2].phone);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator('[data-error="code_mismatch"]')).toBeVisible();
  await page.getByLabel("Employee code").fill(PROFILE[FX.emp2].employeeCode);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/enroll$/);
  await ctx.close();
});

test("AC-17 register pending: stored PENDING with aaguid, BE/BS, UA, IP, site and ticket (read through the admin queue)", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  await addAuthenticator(page);
  const r = await register(page);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const code = r.body.confirmCode as string;
  expect(code).toMatch(/^[A-Z2-7]{6}$/);
  const admin = await signedIn(browser, FX.admin);
  const q = await queue(admin, "PENDING");
  expect(q.items).toHaveLength(1);
  const item = q.items[0];
  expect(item).toMatchObject({ member: { id: "m_emp1" }, status: "PENDING", regIp: FX.ip.inV4, regSiteId: FX.hq, backupEligible: false, backupState: false, synced: false });
  expect(item.aaguid).toMatch(/^[0-9a-f-]{36}$/);
  expect(item.regUa).toContain("Chrome");
  expect(item.regTicketId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(q.raw).not.toContain(code); // the queue never carries the confirm code
  // the owner sees it
  const me = await get<{ credential: { status: string; pending: { confirmCode: string } } }>(emp, "/api/me/state");
  expect(me.body.credential).toMatchObject({ status: "PENDING", pending: { confirmCode: code } });
  await page.goto("/enroll");
  await expect(page.locator(`[data-confirm-code="${code}"]`)).toBeVisible();
  for (const c of [emp, admin]) await c.close();
});

test("AC-17 register pending: without a ticket -> ticket_missing; from an outside IP -> ip_not_allowed", async ({ browser }) => {
  const noTicket = await signedIn(browser, FX.emp1);
  await noTicket.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
  await onboard(noTicket, FX.emp1);
  const r = await post(noTicket, "/api/webauthn/register/options", {});
  expect(r.status).toBe(428);
  expect(r.body.error).toBe("ticket_missing");

  // ticket from inside, then the phone leaves the Wi-Fi before options…
  const emp = await employeeOnSite(browser, FX.emp2);
  await emp.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.out });
  const page = await emp.newPage();
  await page.goto("/");
  await addAuthenticator(page);
  const out = await register(page);
  expect(out.status).toBe(403);
  expect(out.body.error).toBe("ip_not_allowed");
  // …or between options and verify
  await emp.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
  const opts = await post(emp, "/api/webauthn/register/options", {});
  expect(opts.status).toBe(200);
  const admin = await signedIn(browser, FX.admin);
  expect((await queue(admin)).items).toHaveLength(0);
  for (const c of [noTicket, emp, admin]) await c.close();
});

test("AC-17 register pending: the IP is re-checked at verify (switch between options and verify)", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  await addAuthenticator(page);
  // flip the IP header to outside after options were fetched: intercept the verify call only
  await page.route("**/api/webauthn/register/verify", async (route) => {
    await route.continue({ headers: { ...route.request().headers(), "x-test-client-ip": FX.ip.out } });
  });
  const r = await register(page);
  expect(r.status).toBe(403);
  expect(r.body.error).toBe("ip_not_allowed");
  const admin = await signedIn(browser, FX.admin);
  expect((await queue(admin)).items).toHaveLength(0);
  for (const c of [emp, admin]) await c.close();
});

test("AC-17 register pending: a second registration moves the first PENDING to REJECTED", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  const a = await addAuthenticator(page);
  const first = await register(page);
  expect(first.status).toBe(201);
  await removeAuthenticator(a.cdp, a.authenticatorId);
  await addAuthenticator(page);
  const second = await register(page);
  expect(second.status, JSON.stringify(second.body)).toBe(201);
  expect(second.body.confirmCode).not.toBe(first.body.confirmCode);
  const admin = await signedIn(browser, FX.admin);
  const pending = (await queue(admin, "PENDING")).items;
  const rejected = (await queue(admin, "REJECTED")).items;
  expect(pending.map((c) => c.id)).toEqual([(second.body.credential as { id: string }).id]);
  expect(rejected.map((c) => c.id)).toEqual([(first.body.credential as { id: string }).id]);
  expect(rejected[0].decisionNote).toBe("superseded");
  for (const c of [emp, admin]) await c.close();
});

test("AC-18 uv required: a registration signed with UV=0 -> uv_required, nothing stored", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  await addAuthenticator(page, { uv: false });
  const r = await register(page, { uv: "discouraged" });
  expect(r.status, JSON.stringify(r.body)).toBe(403);
  expect(r.body.error).toBe("uv_required");
  const admin = await signedIn(browser, FX.admin);
  expect((await queue(admin)).items).toHaveLength(0);
  for (const c of [emp, admin]) await c.close();
});

test("AC-18 uv required: a replayed registration -> challenge_used", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  await addAuthenticator(page);
  const r = await register(page);
  expect(r.status).toBe(201);
  const replay = await postFromPage(page, "/api/webauthn/register/verify", r.sent);
  expect(replay.status).toBe(409);
  expect(replay.body.error).toBe("challenge_used");
  const admin = await signedIn(browser, FX.admin);
  expect((await queue(admin)).items).toHaveLength(1);
  for (const c of [emp, admin]) await c.close();
});

test("AC-35 synced policy: a BE=1 passkey is stored with the synced flag when the org allows it", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  await addAuthenticator(page, { synced: true });
  const r = await register(page);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.credential).toMatchObject({ synced: true });
  const admin = await signedIn(browser, FX.admin);
  const [item] = (await queue(admin, "PENDING")).items;
  expect(item).toMatchObject({ synced: true, backupEligible: true, backupState: true });
  for (const c of [emp, admin]) await c.close();
});

test("AC-35 synced policy: synced_not_allowed when the org forbids synced passkeys", async ({ browser }) => {
  const owner = await signedIn(browser, FX.owner);
  expect((await patch(owner, "/api/admin/org", { allowSyncedPasskeys: false })).status).toBe(200);
  const emp = await employeeOnSite(browser, FX.emp1);
  const page = await emp.newPage();
  await page.goto("/");
  const synced = await addAuthenticator(page, { synced: true });
  const r = await register(page);
  expect(r.status).toBe(403);
  expect(r.body.error).toBe("synced_not_allowed");
  expect((await queue(owner)).items).toHaveLength(0);
  // a device-bound passkey is still fine
  await removeAuthenticator(synced.cdp, synced.authenticatorId);
  await addAuthenticator(page, { synced: false });
  expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
  const ok = await register(page);
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  for (const c of [owner, emp]) await c.close();
});

test("AC-17 register pending: the /enroll button registers this phone and shows the confirm code", async ({ browser }) => {
  const emp = await employeeOnSite(browser, FX.emp2);
  const page = await emp.newPage();
  await page.goto("/enroll");
  await addAuthenticator(page);
  await page.getByRole("button", { name: "Register fingerprint / Face ID" }).click();
  const code = page.locator("[data-confirm-code]");
  await expect(code).toBeVisible();
  const value = await code.getAttribute("data-confirm-code");
  expect(value).toMatch(/^[A-Z2-7]{6}$/);
  const me = await get<{ credential: { pending: { confirmCode: string } } }>(emp, "/api/me/state");
  expect(me.body.credential.pending.confirmCode).toBe(value);
  await emp.close();
});
