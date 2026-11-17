import { expect, test } from "@playwright/test";
import { punch } from "./helpers/ceremony";
import { approve, approvedEmployee, FX, get, myEvents, queue, reset, scan, setClock, signedIn } from "./helpers/api";
import { addAuthenticator, credentialsOf } from "./helpers/webauthn";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-26 new device: same Google account, new context + empty authenticator -> PENDING; credential_pending; after approval the old passkey -> credential_revoked", async ({ browser, request }) => {
  const T0 = Date.parse("2026-11-17T08:00:05.000Z");
  await setClock(request, { fixedMs: T0 });
  const admin = await signedIn(browser, FX.admin);
  const old = await approvedEmployee(browser, FX.emp1, admin);
  await old.page.goto("/");
  expect((await punch(old.page, "IN")).status).toBe(201);

  // the new phone: a new browser context, an empty authenticator, the SAME Google account (same sub)
  const fresh = await signedIn(browser, FX.emp1);
  await fresh.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
  const page = await fresh.newPage();
  const auth = await addAuthenticator(page);
  expect(await credentialsOf(auth.cdp, auth.authenticatorId)).toEqual([]);
  expect((await scan(fresh, FX.hq, FX.ip.inV4)).status).toBe(303);
  await page.goto("/punch");
  await expect(page.locator("main")).toHaveAttribute("data-credential", "APPROVED"); // the old one still counts for the member
  await page.locator("[data-new-device]").click();
  await expect(page).toHaveURL(/\/enroll$/);
  await page.getByRole("button", { name: "Register fingerprint / Face ID" }).click();
  const codeEl = page.locator("[data-confirm-code]");
  await expect(codeEl).toBeVisible();
  const confirmCode = (await codeEl.getAttribute("data-confirm-code")) as string;

  // the old APPROVED one is untouched, the new one is PENDING
  const pending = (await queue(admin, "PENDING")).items;
  expect(pending).toHaveLength(1);
  expect((await queue(admin, "APPROVED")).items.map((c) => c.id)).toEqual([old.credId]);
  const newCredId = pending[0].id;

  // until approval the new phone cannot punch
  await setClock(request, { fixedMs: T0 + 61_000 });
  expect((await scan(fresh, FX.hq, FX.ip.inV4)).status).toBe(303);
  await page.goto("/");
  const blocked = await punch(page, "OUT");
  expect(blocked.status, JSON.stringify(blocked.body)).toBe(403);
  expect(blocked.body.error).toBe("credential_pending");

  // the admin approves with the code from the NEW phone: old -> REVOKED, new -> APPROVED in one step
  await approve(admin, newCredId, confirmCode);
  expect((await queue(admin, "APPROVED")).items.map((c) => c.id)).toEqual([newCredId]);
  expect((await queue(admin, "REVOKED")).items.map((c) => c.id)).toEqual([old.credId]);
  const ok = await punch(page, "OUT");
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);

  // the old phone's passkey is dead from now on
  await setClock(request, { fixedMs: T0 + 3 * 60_000 });
  expect((await scan(old.emp, FX.hq, FX.ip.inV4)).status).toBe(303);
  await old.page.goto("/");
  const dead = await punch(old.page, "IN");
  expect(dead.status).toBe(403);
  expect(dead.body.error).toBe("credential_revoked");
  expect((await myEvents(fresh)).map((e) => e.kind)).toEqual(["IN", "OUT"]);
  expect((await get(admin, "/api/admin/attendance/verify")).body).toEqual({ ok: true, firstBadSeq: null });
  for (const c of [admin, old.emp, fresh]) await c.close();
});

test("AC-26 new device: a second new phone before approval supersedes the first PENDING (at most one PENDING)", async ({ browser, request }) => {
  await setClock(request, { fixedMs: Date.parse("2026-11-17T08:00:05.000Z") });
  const admin = await signedIn(browser, FX.admin);
  const old = await approvedEmployee(browser, FX.emp1, admin);
  const codes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await signedIn(browser, FX.emp1);
    await ctx.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
    const page = await ctx.newPage();
    await addAuthenticator(page);
    expect((await scan(ctx, FX.hq, FX.ip.inV4)).status).toBe(303);
    await page.goto("/enroll");
    if (i > 0) {
      // the member already has a PENDING passkey: the page shows its code and offers to register another one
      await expect(page.locator(`[data-confirm-code="${codes[0]}"]`)).toBeVisible();
      await page.getByRole("button", { name: "Register a different passkey" }).click();
    }
    await page.getByRole("button", { name: "Register fingerprint / Face ID" }).click();
    await expect(page.locator(`[data-confirm-code]:not([data-confirm-code="${codes[0] ?? ""}"])`)).toBeVisible();
    codes.push((await page.locator("[data-confirm-code]").getAttribute("data-confirm-code")) as string);
    await ctx.close();
  }
  const pending = (await queue(admin, "PENDING")).items;
  expect(pending).toHaveLength(1);
  expect((await queue(admin, "REJECTED")).items[0].decisionNote).toBe("superseded");
  // the superseded phone's code no longer approves anything; the latest one does
  expect((await queue(admin, "APPROVED")).items.map((c) => c.id)).toEqual([old.credId]);
  await approve(admin, pending[0].id, codes[1]);
  expect((await queue(admin, "REVOKED")).items.map((c) => c.id)).toEqual([old.credId]);
  for (const c of [admin, old.emp]) await c.close();
});
