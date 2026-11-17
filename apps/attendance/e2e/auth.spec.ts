import { expect, test } from "@playwright/test";
import { FX, loginAs, reset, sessionOf } from "./helpers/api";

const isEmptySession = (s: unknown) => s === null || (typeof s === "object" && s !== null && Object.keys(s).length === 0);

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-10 non-allowlisted rejected: sign-in page redirects to /signin?error=not_allowlisted", async ({ page, context }) => {
  await page.goto("/signin");
  const form = page.getByTestId("test-login");
  await form.getByLabel("email").fill(FX.stranger);
  await form.getByRole("button", { name: "Test login" }).click();
  await page.waitForURL(/\/signin\?error=not_allowlisted$/);
  await expect(page.locator('main[data-error="not_allowlisted"]')).toBeVisible();
  expect(isEmptySession(await sessionOf(context))).toBe(true);
});

test("AC-10 non-allowlisted rejected: gmail and stranger accounts get no session", async ({ browser }) => {
  for (const email of [FX.gmail, FX.stranger]) {
    const ctx = await browser.newContext();
    const r = await loginAs(ctx, email);
    expect(r.status).toBe(403);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_allowlisted");
    expect(r.url).toMatch(/\/signin\?error=not_allowlisted$/);
    expect(isEmptySession(await sessionOf(ctx))).toBe(true);
    const cookies = await ctx.cookies();
    expect(cookies.some((c) => c.name.includes("session-token"))).toBe(false);
    await ctx.close();
  }
});

test("AC-11 sign-in policy: allowlisted verified email signs in", async ({ context }) => {
  const r = await loginAs(context, FX.emp1);
  expect(r.ok).toBe(true);
  const s = await sessionOf(context);
  expect(s?.user?.email).toBe(FX.emp1);
  expect(s?.user?.memberId).toBe("m_emp1");
  // email is matched case-insensitively
  const ctx2 = await context.browser()!.newContext();
  expect((await loginAs(ctx2, "Admin@Acme.TEST")).ok).toBe(true);
  expect((await sessionOf(ctx2))?.user?.email).toBe(FX.admin);
  await ctx2.close();
});

test("AC-11 sign-in policy: unverified email -> email_unverified, no session", async ({ context }) => {
  const r = await loginAs(context, FX.emp1, { emailVerified: false });
  expect(r.ok).toBe(false);
  expect(r.error).toBe("email_unverified");
  expect(isEmptySession(await sessionOf(context))).toBe(true);
});

test("AC-11 sign-in policy: org hd set + other domain -> domain_not_allowed", async ({ browser, request }) => {
  await reset(request, { org: { allowedGoogleHd: "acme.test" } });
  const gmail = await browser.newContext();
  expect(await loginAs(gmail, FX.gmail)).toMatchObject({ ok: false, error: "domain_not_allowed" });
  expect(isEmptySession(await sessionOf(gmail))).toBe(true);
  const ok = await browser.newContext();
  expect((await loginAs(ok, FX.emp1)).ok).toBe(true);

  await reset(request, { org: { allowedGoogleHd: "corp.example" } });
  const other = await browser.newContext();
  // allowlisted email, but its Google hd is not the org's domain
  expect(await loginAs(other, FX.emp1)).toMatchObject({ ok: false, error: "domain_not_allowed" });
  expect(isEmptySession(await sessionOf(other))).toBe(true);
  for (const c of [gmail, ok, other]) await c.close();
});

test("AC-11 sign-in policy: same email with a different sub -> account_mismatch", async ({ browser }) => {
  const first = await browser.newContext();
  expect((await loginAs(first, FX.emp1, { sub: "google-sub-A" })).ok).toBe(true);
  const second = await browser.newContext();
  expect(await loginAs(second, FX.emp1, { sub: "google-sub-B" })).toMatchObject({ ok: false, error: "account_mismatch" });
  expect(isEmptySession(await sessionOf(second))).toBe(true);
  // the pinned sub still works
  const third = await browser.newContext();
  expect((await loginAs(third, FX.emp1, { sub: "google-sub-A" })).ok).toBe(true);
  // the same Google account cannot claim a second allowlisted email
  const fourth = await browser.newContext();
  expect(await loginAs(fourth, FX.emp2, { sub: "google-sub-A" })).toMatchObject({ ok: false, error: "account_mismatch" });
  for (const c of [first, second, third, fourth]) await c.close();
});
