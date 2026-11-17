import { expect, test } from "@playwright/test";
import { FX, get, post, reset, setClock, signedIn } from "./helpers/api";
import { addAuthenticator } from "./helpers/webauthn";

test("AC-37 full journey: empty deployment -> setup -> kiosk -> scan -> sign in -> onboard -> enrol -> approve -> IN -> OUT -> CSV -> verify", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const T0 = Date.parse("2026-11-17T08:00:05.000Z"); // 5 s into a 30 s window
  await reset(request, { fixture: "empty" });
  await setClock(request, { fixedMs: T0 });

  // --- admin (API): bootstrap owner -> org + first site + office network -> member -> kiosk
  const owner = await signedIn(browser, FX.owner);
  const setup = await post(owner, "/api/admin/setup", {
    org: { name: "Acme Live", allowSyncedPasskeys: true },
    site: { name: "Main office", timezone: "Europe/Berlin", qrMode: "rotating", networks: [{ cidr: "198.51.100.0/24", label: "Office Wi-Fi" }, { cidr: "2001:db8:10::/48" }] },
  });
  expect(setup.status, JSON.stringify(setup.body)).toBe(201);
  const { siteId } = setup.body as { siteId: string };
  const added = await post(owner, "/api/admin/members", { email: "Emp1@Acme.test", employeeCode: "E001" });
  expect(added.status).toBe(201);
  const kiosk = await post(owner, "/api/admin/kiosks", { siteId, name: "Entrance TV" });
  expect(kiosk.status).toBe(201);
  const { pairUrl } = kiosk.body as { pairUrl: string };

  // --- kiosk: pair from the office network and show the rotating QR (its timers run on page.clock)
  const tv = await browser.newContext();
  await tv.setExtraHTTPHeaders({ "x-test-client-ip": "198.51.100.200" });
  const screen = await tv.newPage();
  await screen.clock.install({ time: T0 });
  await screen.goto(new URL(pairUrl).pathname + new URL(pairUrl).search);
  await expect(screen).toHaveURL(/\/kiosk$/);
  const qr = screen.locator("[data-qr]");
  await expect(qr).toBeVisible();
  const firstUrl = (await qr.getAttribute("data-url")) as string;

  // --- employee's phone (UI): scan the kiosk's data-url on the Wi-Fi, sign in, onboard, enrol
  const phone = await browser.newContext();
  await phone.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
  const p = await phone.newPage();
  await addAuthenticator(p);
  await p.goto(firstUrl);
  await expect(p).toHaveURL(/\/signin\?callbackUrl=%2Fpunch$/); // the token is gone from the address bar
  const form = p.getByTestId("test-login"); // stands in for "Sign in with Google"
  await form.getByLabel("email").fill(FX.emp1);
  await form.getByRole("button", { name: "Test login" }).click();
  await expect(p).toHaveURL(/\/onboarding$/);
  await p.getByLabel("Full name").fill("Emma One");
  await p.getByLabel("Employee code").fill("E001");
  await p.getByLabel("Phone").fill("+49 30 1234567");
  await p.getByRole("button", { name: "Continue" }).click();
  await expect(p).toHaveURL(/\/enroll$/);
  await p.getByRole("button", { name: "Register fingerprint / Face ID" }).click();
  const codeEl = p.locator("[data-confirm-code]");
  await expect(codeEl).toBeVisible();
  const confirmCode = (await codeEl.getAttribute("data-confirm-code")) as string;

  // --- admin approves in person, typing the code read from the phone
  const queue = await get<{ credentials: { id: string; member: { email: string } }[] }>(owner, "/api/admin/credentials?status=PENDING");
  expect(queue.body.credentials.map((c) => c.member.email)).toEqual([FX.emp1]);
  expect(JSON.stringify(queue.body)).not.toContain(confirmCode);
  const approved = await post(owner, `/api/admin/credentials/${queue.body.credentials[0].id}/approve`, { confirmCode });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  // --- check in (the first scan's ticket is still live)
  await p.goto("/punch");
  await p.getByRole("button", { name: "Check in" }).click();
  await expect(p.locator('[data-punched="IN"]')).toBeVisible();

  // --- +61 s: the kiosk shows a new code, the phone rescans it and checks out
  await setClock(request, { fixedMs: T0 + 61_000 });
  await screen.clock.fastForward(61_000);
  await expect(qr).not.toHaveAttribute("data-url", firstUrl);
  const secondUrl = (await qr.getAttribute("data-url")) as string;
  await p.goto(secondUrl);
  await expect(p).toHaveURL(/\/punch$/);
  await p.getByRole("button", { name: "Check out" }).click();
  await expect(p.locator('[data-punched="OUT"]')).toBeVisible();

  // --- the report: CSV has both rows, the chain verifies
  const csv = (await (await owner.request.get("/api/admin/attendance/export.csv")).text()).trim().split("\r\n");
  expect(csv).toHaveLength(3);
  expect(csv[1]).toMatch(/^1,IN,PUNCH,emp1@acme\.test,Emma One,E001,Main office,2026-11-17T08:00:05\.000Z,2026-11-17 09:00:05,/);
  expect(csv[2]).toMatch(/^2,OUT,PUNCH,emp1@acme\.test,Emma One,E001,Main office,2026-11-17T08:01:06\.000Z,/);
  expect((await get(owner, "/api/admin/attendance/verify")).body).toEqual({ ok: true, firstBadSeq: null });
  await p.goto("/me");
  await expect(p.locator('tr[data-kind="IN"]')).toBeVisible();
  await expect(p.locator('tr[data-kind="OUT"]')).toBeVisible();
  for (const c of [owner, tv, phone]) await c.close();
});
