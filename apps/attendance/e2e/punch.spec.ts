import { expect, test } from "@playwright/test";
import { punch } from "./helpers/ceremony";
import { approvedEmployee, FX, get, myEvents, reset, scan, setClock, signedIn } from "./helpers/api";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-21 in and out: IN, then OUT after +61 s (frozen clock) -> 2 rows, consecutive seq, verify ok, both in /me", async ({ browser, request }) => {
  const T0 = Date.parse("2026-11-17T08:30:10.000Z");
  await setClock(request, { fixedMs: T0 });
  const { emp, page } = await approvedEmployee(browser, FX.emp1);
  await page.goto("/");
  const first = await punch(page, "IN");
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(first.body.event).toMatchObject({ kind: "IN", seq: 1, recordedAt: T0, siteId: FX.hq });

  await setClock(request, { fixedMs: T0 + 61_000 });
  expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
  const second = await punch(page, "OUT");
  expect(second.status, JSON.stringify(second.body)).toBe(201);
  expect(second.body.event).toMatchObject({ kind: "OUT", seq: 2, recordedAt: T0 + 61_000 });

  const admin = await signedIn(browser, FX.admin);
  const v = await get(admin, "/api/admin/attendance/verify");
  expect(v.status).toBe(200);
  expect(v.body).toEqual({ ok: true, firstBadSeq: null });

  const mine = await myEvents(emp);
  expect(mine.map((e) => [e.seq, e.kind, e.source])).toEqual([[1, "IN", "PUNCH"], [2, "OUT", "PUNCH"]]);
  await page.goto("/me");
  await expect(page.locator('tr[data-seq="1"][data-kind="IN"]')).toBeVisible();
  await expect(page.locator('tr[data-seq="2"][data-kind="OUT"]')).toBeVisible();
  for (const c of [emp, admin]) await c.close();
});

test("AC-21 in and out: the /punch page offers the one valid action and checks in through the UI", async ({ browser, request }) => {
  const T0 = Date.parse("2026-11-17T08:30:10.000Z");
  await setClock(request, { fixedMs: T0 });
  const { emp, page } = await approvedEmployee(browser, FX.emp2);
  await page.goto("/punch");
  await expect(page.locator("main")).toHaveAttribute("data-state", "OUT");
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.locator('[data-punched="IN"]')).toBeVisible();
  await setClock(request, { fixedMs: T0 + 61_000 });
  expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
  await page.goto("/punch");
  await expect(page.locator("main")).toHaveAttribute("data-state", "IN");
  await page.getByRole("button", { name: "Check out" }).click();
  await expect(page.locator('[data-punched="OUT"]')).toBeVisible();
  await expect(page.locator("[data-new-device]")).toBeVisible();
  await emp.close();
});

test("AC-27 server time only: recorded_at = server clock (with test offset); client time fields are ignored", async ({ browser, request }) => {
  const { emp, page } = await approvedEmployee(browser, FX.emp1);
  // frozen two hours before real time, so the later +3 h offset punch comes after it
  const fixed = Math.floor(Date.now() / 1000) * 1000 - 2 * 3_600_000;
  await setClock(request, { fixedMs: fixed });
  expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
  await page.goto("/");
  const lie = Date.parse("2026-01-01T00:00:00.000Z");
  const r = await punch(page, "IN", {
    extra: { recordedAt: lie, effectiveAt: lie, effective_at: lie, time: "2026-01-01T00:00:00Z", serverNow: lie },
    headers: { "x-client-time": String(lie), "x-recorded-at": String(lie) },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.event).toMatchObject({ recordedAt: fixed, effectiveAt: fixed });
  // with an offset instead of a frozen clock
  const off = await setClock(request, { offsetMs: 3 * 3_600_000 });
  expect((await scan(emp, FX.hq, FX.ip.inV4)).status).toBe(303);
  const out = await punch(page, "OUT", { extra: { recordedAt: lie } });
  expect(out.status).toBe(201);
  const rec = (out.body.event as { recordedAt: number }).recordedAt;
  expect(Math.abs(rec - off.nowMs)).toBeLessThan(30_000);
  expect(rec - Date.now()).toBeGreaterThan(3 * 3_600_000 - 30_000);
  const mine = await myEvents(emp);
  expect(mine.map((e) => e.recordedAt)).toEqual([fixed, rec]);
  expect(mine.every((e) => e.effectiveAt === e.recordedAt)).toBe(true);
  await emp.close();
});
