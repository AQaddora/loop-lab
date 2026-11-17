import { expect, test } from "@playwright/test";
import { approve, auditFor, FX, get, onboardAndEnroll, patch, post, queue, reset, signedIn } from "./helpers/api";
import { addAuthenticator, removeAuthenticator } from "./helpers/webauthn";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("AC-20 approvals: approve with the right confirmCode -> APPROVED + audit row; the queue never shows the code", async ({ browser }) => {
  const emp = await signedIn(browser, FX.emp1);
  const page = await emp.newPage();
  await addAuthenticator(page);
  const { credId, confirmCode } = await onboardAndEnroll(page, FX.emp1);
  const admin = await signedIn(browser, FX.admin);
  const q = await queue(admin, "PENDING");
  expect(q.items.map((c) => c.id)).toEqual([credId]);
  expect(q.raw).not.toContain(confirmCode);
  expect(q.raw.toLowerCase()).not.toContain("confirmcode");

  for (const bad of [{}, { confirmCode: "" }, { confirmCode: "AAAAAA" }, { confirmCode: `${confirmCode}X` }]) {
    const r = await post(admin, `/api/admin/credentials/${credId}/approve`, bad);
    expect(r.status, JSON.stringify(bad)).toBe(403);
    expect(r.body.error, JSON.stringify(bad)).toBe("confirm_code_mismatch");
  }
  const ok = await approve(admin, credId, confirmCode.toLowerCase());
  expect((ok.body.credential as { status: string }).status).toBe("APPROVED");
  const audit = await auditFor(admin, credId);
  expect(audit).toEqual([expect.objectContaining({ action: "credential.approve", actorMemberId: "m_admin" })]);
  const me = await get<{ credential: { status: string } }>(emp, "/api/me/state");
  expect(me.body.credential.status).toBe("APPROVED");
  // approving again: not PENDING any more
  expect((await post(admin, `/api/admin/credentials/${credId}/approve`, { confirmCode })).body.error).toBe("invalid_state");
  for (const c of [emp, admin]) await c.close();
});

test("AC-20 approvals: reject -> REJECTED; non-PENDING approve or reject -> invalid_state; revoke only APPROVED", async ({ browser }) => {
  const emp = await signedIn(browser, FX.emp1);
  const page = await emp.newPage();
  const a1 = await addAuthenticator(page);
  const first = await onboardAndEnroll(page, FX.emp1);
  const admin = await signedIn(browser, FX.admin);
  expect((await post(admin, `/api/admin/credentials/${first.credId}/revoke`, {})).body.error).toBe("invalid_state");
  const rej = await post(admin, `/api/admin/credentials/${first.credId}/reject`, {});
  expect(rej.status).toBe(200);
  expect((rej.body.credential as { status: string }).status).toBe("REJECTED");
  expect((await post(admin, `/api/admin/credentials/${first.credId}/reject`, {})).body.error).toBe("invalid_state");
  expect((await post(admin, `/api/admin/credentials/${first.credId}/approve`, { confirmCode: first.confirmCode })).body.error).toBe("invalid_state");

  // a new passkey, approved, then a newer one approved: the previous APPROVED becomes REVOKED in the same step
  await removeAuthenticator(a1.cdp, a1.authenticatorId);
  const a2 = await addAuthenticator(page);
  const second = await onboardAndEnroll(page, FX.emp1);
  await approve(admin, second.credId, second.confirmCode);
  await removeAuthenticator(a2.cdp, a2.authenticatorId);
  await addAuthenticator(page);
  const third = await onboardAndEnroll(page, FX.emp1);
  await approve(admin, third.credId, third.confirmCode);
  expect((await queue(admin, "APPROVED")).items.map((c) => c.id)).toEqual([third.credId]);
  expect((await queue(admin, "REVOKED")).items.map((c) => c.id)).toEqual([second.credId]);
  // revoke the approved one
  const rev = await post(admin, `/api/admin/credentials/${third.credId}/revoke`, {});
  expect((rev.body.credential as { status: string }).status).toBe("REVOKED");
  expect((await get<{ credential: { status: string } }>(emp, "/api/me/state")).body.credential.status).toBe("NONE");
  const actions = (await auditFor(admin, first.credId)).map((e) => e.action);
  expect(actions).toEqual(["credential.reject"]);
  expect((await auditFor(admin, third.credId)).map((e) => e.action).sort()).toEqual(["credential.approve", "credential.revoke"]);
  for (const c of [emp, admin]) await c.close();
});

test("AC-20 approvals: approving one's own credential -> forbidden_self_action; a suspended member's passkey -> invalid_state", async ({ browser }) => {
  // the admin enrols a passkey of their own (admins are ACTIVE with a profile in the fixture)
  const admin = await signedIn(browser, FX.admin);
  const page = await admin.newPage();
  await addAuthenticator(page);
  await admin.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
  const { scan } = await import("./helpers/api");
  expect((await scan(admin, FX.hq, FX.ip.inV4)).status).toBe(303);
  await page.goto("/");
  const { register } = await import("./helpers/ceremony");
  const own = await register(page);
  expect(own.status, JSON.stringify(own.body)).toBe(201);
  const ownId = (own.body.credential as { id: string }).id;
  const r = await post(admin, `/api/admin/credentials/${ownId}/approve`, { confirmCode: own.body.confirmCode });
  expect(r.status).toBe(403);
  expect(r.body.error).toBe("forbidden_self_action");
  expect((await post(admin, `/api/admin/credentials/${ownId}/reject`, {})).body.error).toBe("forbidden_self_action");
  // the owner may approve the admin's passkey
  const owner = await signedIn(browser, FX.owner);
  await approve(owner, ownId, own.body.confirmCode as string);

  // a suspended member cannot get a passkey approved
  const emp = await signedIn(browser, FX.emp1);
  const p2 = await emp.newPage();
  await addAuthenticator(p2);
  const e = await onboardAndEnroll(p2, FX.emp1);
  expect((await patch(owner, "/api/admin/members/m_emp1", { status: "SUSPENDED" })).status).toBe(200);
  expect((await post(owner, `/api/admin/credentials/${e.credId}/approve`, { confirmCode: e.confirmCode })).body.error).toBe("invalid_state");
  for (const c of [admin, owner, emp]) await c.close();
});

test("AC-20 approvals: employee -> forbidden; unknown credential -> bad_request; foreign Origin -> bad_origin", async ({ browser }) => {
  const emp = await signedIn(browser, FX.emp1);
  const page = await emp.newPage();
  await addAuthenticator(page);
  const { credId, confirmCode } = await onboardAndEnroll(page, FX.emp1);
  const emp2 = await signedIn(browser, FX.emp2);
  for (const d of ["approve", "reject", "revoke"]) {
    const r = await post(emp2, `/api/admin/credentials/${credId}/${d}`, { confirmCode });
    expect(r.status, d).toBe(403);
    expect(r.body.error, d).toBe("forbidden");
    // even the credential's owner cannot use the admin API
    expect((await post(emp, `/api/admin/credentials/${credId}/${d}`, { confirmCode })).body.error).toBe("forbidden");
  }
  expect((await get(emp, "/api/admin/credentials?status=PENDING")).body.error).toBe("forbidden");
  const admin = await signedIn(browser, FX.admin);
  expect((await post(admin, "/api/admin/credentials/nope/approve", { confirmCode })).body.error).toBe("bad_request");
  expect((await post(admin, `/api/admin/credentials/${credId}/approve`, { confirmCode }, { origin: "https://evil.example" })).body.error).toBe("bad_origin");
  expect((await queue(admin, "PENDING")).items).toHaveLength(1);
  for (const c of [emp, emp2, admin]) await c.close();
});

test("AC-20 approvals: the admin page approves with the code typed from the phone", async ({ browser }) => {
  const emp = await signedIn(browser, FX.emp2);
  const ep = await emp.newPage();
  await addAuthenticator(ep);
  const { credId, confirmCode } = await onboardAndEnroll(ep, FX.emp2);
  const admin = await signedIn(browser, FX.admin);
  const page = await admin.newPage();
  await page.goto("/admin/credentials");
  const row = page.locator(`tr[data-credential="${credId}"]`);
  await expect(row).toBeVisible();
  await row.getByLabel(`code for ${FX.emp2}`).fill("WRONG1");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator('[data-error="confirm_code_mismatch"]')).toBeVisible();
  await row.getByLabel(`code for ${FX.emp2}`).fill(confirmCode);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(`li[data-approved="${credId}"]`)).toBeVisible();
  for (const c of [emp, admin]) await c.close();
});
