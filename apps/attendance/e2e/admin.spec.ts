import { expect, test } from "@playwright/test";
import { auditFor, del, FX, get, loginAs, patch, post, reset, signedIn } from "./helpers/api";

const SETUP = {
  org: { name: "Acme Journey", allowSyncedPasskeys: true },
  site: { name: "HQ", timezone: "Europe/Berlin", networks: [{ cidr: "198.51.100.0/24", label: "Wi-Fi" }] },
};

type Member = { id: string; email: string; role: string; status: string; employeeCode: string | null };

test.describe("AC-42 bootstrap", () => {
  test.beforeEach(async ({ request }) => {
    await reset(request, { fixture: "empty" });
  });

  test("AC-42 bootstrap: only BOOTSTRAP_OWNER_EMAIL can sign in to an empty deployment", async ({ browser }) => {
    for (const email of [FX.stranger, FX.emp1, FX.admin, FX.gmail]) {
      const ctx = await browser.newContext();
      const r = await loginAs(ctx, email);
      expect(r.status, email).toBe(403);
      expect(r.error, email).toBe("not_allowlisted");
      await ctx.close();
    }
    const unverified = await browser.newContext();
    expect(await loginAs(unverified, FX.owner, { emailVerified: false })).toMatchObject({ ok: false, error: "not_allowlisted" });
    const owner = await browser.newContext();
    expect((await loginAs(owner, FX.owner)).ok).toBe(true);
    for (const c of [unverified, owner]) await c.close();
  });

  test("AC-42 bootstrap: setup creates org + owner + first site once; a second setup -> forbidden", async ({ browser, request }) => {
    const owner = await signedIn(browser, FX.owner, { sub: "owner-sub-1" });
    // nobody without the bootstrap session can run it
    expect((await post(request, "/api/admin/setup", SETUP)).body.error).toBe("unauthenticated");

    const r = await post(owner, "/api/admin/setup", SETUP);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { orgId, ownerId, siteId } = r.body as { orgId: string; ownerId: string; siteId: string };
    expect(orgId && ownerId && siteId).toBeTruthy();

    // the same bootstrap session is now the owner
    const ms = await get<{ members: Member[] }>(owner, "/api/admin/members");
    expect(ms.status).toBe(200);
    expect(ms.body.members).toEqual([expect.objectContaining({ id: ownerId, email: FX.owner, role: "owner", status: "ACTIVE" })]);
    const audit = await auditFor(owner, orgId);
    expect(audit.map((a) => a.action)).toContain("org.setup");
    expect((await auditFor(owner, siteId)).map((a) => a.action)).toContain("site.add");

    const again = await post(owner, "/api/admin/setup", SETUP);
    expect(again.status).toBe(403);
    expect(again.body.error).toBe("forbidden");

    // the owner's Google sub is pinned; the bootstrap email has no special power any more
    const other = await browser.newContext();
    expect(await loginAs(other, FX.owner, { sub: "someone-else" })).toMatchObject({ ok: false, error: "account_mismatch" });
    const again2 = await signedIn(browser, FX.owner, { sub: "owner-sub-1" });
    expect((await post(again2, "/api/admin/setup", SETUP)).body.error).toBe("forbidden");
    const stranger = await browser.newContext();
    expect((await loginAs(stranger, FX.stranger)).error).toBe("not_allowlisted");
    for (const c of [owner, other, again2, stranger]) await c.close();
  });

  test("AC-42 bootstrap: setup validates its input atomically (bad CIDR -> nothing created)", async ({ browser }) => {
    const owner = await signedIn(browser, FX.owner);
    const bad = await post(owner, "/api/admin/setup", { ...SETUP, site: { ...SETUP.site, networks: [{ cidr: "10.0.0.0/8" }] } });
    expect(bad.body.error).toBe("cidr_not_public");
    const ok = await post(owner, "/api/admin/setup", SETUP);
    expect(ok.status).toBe(201);
    await owner.close();
  });
});

test.describe("AC-43 member rules", () => {
  test.beforeEach(async ({ request }) => {
    await reset(request);
  });

  test("AC-43 member rules: admin adds one member or an array; each write audited", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    const one = await post(admin, "/api/admin/members", { email: "New1@Acme.test", employeeCode: "E100" });
    expect(one.status).toBe(201);
    const m1 = (one.body as { member: Member }).member;
    expect(m1).toMatchObject({ email: "new1@acme.test", role: "employee", status: "INVITED", employeeCode: "E100" });

    const many = await post(admin, "/api/admin/members", [{ email: "new2@acme.test" }, { email: "new3@acme.test", employeeCode: "E103" }]);
    expect(many.status).toBe(201);
    expect((many.body as { members: Member[] }).members.map((m) => m.email)).toEqual(["new2@acme.test", "new3@acme.test"]);
    // duplicates are refused and an array is all-or-nothing
    expect((await post(admin, "/api/admin/members", { email: FX.emp1 })).body.error).toBe("bad_request");
    expect((await post(admin, "/api/admin/members", [{ email: "new4@acme.test" }, { email: FX.emp2 }])).body.error).toBe("bad_request");
    const list = await get<{ members: Member[] }>(admin, "/api/admin/members");
    expect(list.body.members.map((m) => m.email)).not.toContain("new4@acme.test");

    const a = await auditFor(admin, m1.id);
    expect(a).toEqual([expect.objectContaining({ action: "member.add", actorMemberId: "m_admin" })]);
    await admin.close();
  });

  test("AC-43 member rules: admin edits code/status/email of an employee", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    const code = await patch(admin, "/api/admin/members/m_emp1", { employeeCode: "E009" });
    expect(code.status).toBe(200);
    expect((code.body as { member: Member }).member.employeeCode).toBe("E009");
    const email = await patch(admin, "/api/admin/members/m_emp1", { email: "Emp1.New@Acme.test" });
    expect((email.body as { member: Member }).member.email).toBe("emp1.new@acme.test");
    // an INVITED member cannot be suspended (ACTIVE <-> SUSPENDED only), but can be removed; REMOVED is terminal
    expect((await patch(admin, "/api/admin/members/m_emp2", { status: "SUSPENDED" })).body.error).toBe("invalid_state");
    expect((await patch(admin, "/api/admin/members/m_emp2", { status: "REMOVED" })).status).toBe(200);
    expect((await patch(admin, "/api/admin/members/m_emp2", { status: "ACTIVE" })).body.error).toBe("invalid_state");
    expect((await patch(admin, "/api/admin/members/m_emp2", { employeeCode: "X" })).body.error).toBe("invalid_state");
    const actions = (await auditFor(admin, "m_emp1")).map((e) => e.action);
    expect(actions.filter((x) => x === "member.update")).toHaveLength(2);
    await admin.close();
  });

  test("AC-43 member rules: admin granting admin/owner -> forbidden; the owner may", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    expect((await post(admin, "/api/admin/members", { email: "boss@acme.test", role: "admin" })).body.error).toBe("forbidden");
    expect((await post(admin, "/api/admin/members", { email: "boss@acme.test", role: "owner" })).body.error).toBe("forbidden");
    expect((await patch(admin, "/api/admin/members/m_emp1", { role: "admin" })).body.error).toBe("forbidden");
    // admins manage employees only
    expect((await patch(admin, "/api/admin/members/m_owner", { employeeCode: "X1" })).body.error).toBe("forbidden");
    const owner = await signedIn(browser, FX.owner);
    expect((await patch(owner, "/api/admin/members/m_emp1", { role: "admin" })).status).toBe(200);
    expect((await post(owner, "/api/admin/members", { email: "boss@acme.test", role: "owner" })).status).toBe(201);
    for (const c of [admin, owner]) await c.close();
  });

  test("AC-43 member rules: own role or status -> forbidden_self_action; last ACTIVE owner -> invalid_state", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    expect((await patch(admin, "/api/admin/members/m_admin", { status: "SUSPENDED" })).body.error).toBe("forbidden_self_action");
    expect((await patch(admin, "/api/admin/members/m_admin", { role: "employee" })).body.error).toBe("forbidden_self_action");
    const owner = await signedIn(browser, FX.owner);
    // the only owner
    for (const change of [{ role: "admin" }, { status: "SUSPENDED" }, { status: "REMOVED" }]) {
      const r = await patch(owner, "/api/admin/members/m_owner", change);
      expect(r.body.error, JSON.stringify(change)).toBe("invalid_state");
    }
    // with a second owner, demoting yourself is still a self action
    expect((await patch(owner, "/api/admin/members/m_admin", { role: "owner" })).status).toBe(200);
    expect((await patch(owner, "/api/admin/members/m_owner", { role: "admin" })).body.error).toBe("forbidden_self_action");
    for (const c of [admin, owner]) await c.close();
  });

  test("AC-43 member rules: google_sub is not writable", async ({ browser }) => {
    const owner = await signedIn(browser, FX.owner);
    for (const body of [{ googleSub: "attacker" }, { google_sub: "attacker" }, { email: "x@acme.test", googleSub: "attacker" }]) {
      const r = await patch(owner, "/api/admin/members/m_emp1", body);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("bad_request");
    }
    // emp1's pinned sub survives an email edit: a different Google account on the new email is refused
    const emp = await signedIn(browser, FX.emp1, { sub: "emp1-google" });
    expect((await patch(owner, "/api/admin/members/m_emp1", { email: "emp1b@acme.test" })).status).toBe(200);
    const thief = await browser.newContext();
    expect(await loginAs(thief, "emp1b@acme.test", { sub: "thief-google" })).toMatchObject({ ok: false, error: "account_mismatch" });
    for (const c of [owner, emp, thief]) await c.close();
  });

  test("AC-43 member rules: a member suspended by an admin gets suspended at next sign-in and next API call", async ({ browser }) => {
    const owner = await signedIn(browser, FX.owner);
    const admin = await signedIn(browser, FX.admin);
    expect((await get(admin, "/api/admin/members")).status).toBe(200);
    expect((await patch(owner, "/api/admin/members/m_admin", { status: "SUSPENDED" })).status).toBe(200);
    const call = await get(admin, "/api/admin/members");
    expect(call.status).toBe(403);
    expect(call.body.error).toBe("suspended");
    const again = await browser.newContext();
    expect(await loginAs(again, FX.admin)).toMatchObject({ ok: false, error: "suspended" });
    // and back
    expect((await patch(owner, "/api/admin/members/m_admin", { status: "ACTIVE" })).status).toBe(200);
    expect((await get(admin, "/api/admin/members")).status).toBe(200);
    const audit = await auditFor(owner, "m_admin");
    expect(audit.filter((e) => e.action === "member.update")).toHaveLength(2);
    for (const c of [owner, admin, again]) await c.close();
  });

  test("AC-43 member rules: the members page lists the allowlist and adds a member from a CSV paste", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    const page = await admin.newPage();
    await page.goto("/admin/members");
    await expect(page.locator(`tr[data-member="${FX.emp1}"]`)).toBeVisible();
    await page.getByLabel("csv").fill("email,code,role\ncsv1@acme.test,E201\ncsv2@acme.test,E202,employee");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator('tr[data-member="csv2@acme.test"]')).toBeVisible();
    await expect(page.locator('tr[data-member="csv1@acme.test"]')).toContainText("E201");
    await admin.close();
  });

  test("AC-43 member rules: employees and anonymous callers cannot use the member API", async ({ browser, request }) => {
    const emp = await signedIn(browser, FX.emp1);
    expect((await get(emp, "/api/admin/members")).body.error).toBe("forbidden");
    expect((await post(emp, "/api/admin/members", { email: "x@acme.test" })).body.error).toBe("forbidden");
    expect((await get(request, "/api/admin/members")).body.error).toBe("unauthenticated");
    await emp.close();
  });
});

test.describe("AC-31 sites and networks", () => {
  test.beforeEach(async ({ request }) => {
    await reset(request);
  });

  type Site = { id: string; name: string; qrMode: string; rotationSeconds: number; graceWindows: number; qrKeyVersion: number; status: string; timezone: string; networks: { id: string; cidr: string }[] };

  test("AC-31 sites and networks: admin adds and edits sites; out-of-range rotation/grace -> bad_request; DISABLED status", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    const created = await post(admin, "/api/admin/sites", { name: "Branch", timezone: "Asia/Dubai", qrMode: "static", rotationSeconds: 60, graceWindows: 2 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const site = (created.body as { site: Site }).site;
    expect(site).toMatchObject({ name: "Branch", timezone: "Asia/Dubai", qrMode: "static", rotationSeconds: 60, graceWindows: 2, status: "ACTIVE", qrKeyVersion: 1 });

    for (const bad of [{ rotationSeconds: 9 }, { rotationSeconds: 121 }, { graceWindows: -1 }, { graceWindows: 3 }, { rotationSeconds: 30.5 }, { timezone: "Mars/Olympus" }, { qrMode: "sometimes" }, { status: "PAUSED" }, { qrKeyVersion: 9 }]) {
      const r = await patch(admin, `/api/admin/sites/${site.id}`, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error, JSON.stringify(bad)).toBe("bad_request");
    }
    for (const bad of [{ name: "x", rotationSeconds: 5 }, { name: "x", graceWindows: 9 }]) {
      expect((await post(admin, "/api/admin/sites", bad)).body.error).toBe("bad_request");
    }

    const edited = await patch(admin, `/api/admin/sites/${site.id}`, { name: "Branch 2", qrMode: "rotating", rotationSeconds: 10, graceWindows: 0, timezone: "UTC" });
    expect((edited.body as { site: Site }).site).toMatchObject({ name: "Branch 2", qrMode: "rotating", rotationSeconds: 10, graceWindows: 0 });
    const disabled = await patch(admin, `/api/admin/sites/${site.id}`, { status: "DISABLED" });
    expect((disabled.body as { site: Site }).site.status).toBe("DISABLED");
    const bumped = await patch(admin, `/api/admin/sites/${site.id}`, { bumpKeyVersion: true });
    expect((bumped.body as { site: Site }).site.qrKeyVersion).toBe(2);

    const audit = (await auditFor(admin, site.id)).map((e) => e.action);
    expect(audit.filter((a) => a === "site.add")).toHaveLength(1);
    expect(audit.filter((a) => a === "site.update")).toHaveLength(3);
    await admin.close();
  });

  test("AC-31 sites and networks: adds and removes CIDRs; cidr_invalid / cidr_too_broad / cidr_not_public", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    const add = await post(admin, `/api/admin/sites/${FX.wh}/networks`, { cidr: "203.0.113.0/24", label: "WH v4" });
    expect(add.status).toBe(201);
    const netId = (add.body as { networkId: string }).networkId;
    const v6 = await post(admin, `/api/admin/sites/${FX.wh}/networks`, { cidr: "2001:DB8:20::/48" });
    expect((v6.body as { site: Site }).site.networks.map((n) => n.cidr)).toEqual(["192.0.2.0/24", "203.0.113.0/24", "2001:db8:20::/48"]);
    expect((await post(admin, `/api/admin/sites/${FX.wh}/networks`, { cidr: "203.0.113.7/24" })).body.error).toBe("bad_request"); // same network

    const cases: [string, string][] = [
      ["not-a-cidr", "cidr_invalid"],
      ["203.0.113.0", "cidr_invalid"],
      ["::ffff:203.0.113.0/120", "cidr_invalid"],
      ["0.0.0.0/0", "cidr_too_broad"],
      ["203.0.0.0/8", "cidr_too_broad"],
      ["2001:db8::/16", "cidr_too_broad"],
      ["10.0.0.0/8", "cidr_not_public"],
      ["192.168.1.0/24", "cidr_not_public"],
      ["127.0.0.0/8", "cidr_not_public"],
      ["100.64.0.0/10", "cidr_not_public"],
      ["fd00::/8", "cidr_not_public"],
      ["fe80::/10", "cidr_not_public"],
    ];
    for (const [cidr, code] of cases) {
      const r = await post(admin, `/api/admin/sites/${FX.wh}/networks`, { cidr });
      expect(r.status, cidr).toBe(400);
      expect(r.body.error, cidr).toBe(code);
    }

    const removed = await del(admin, `/api/admin/sites/${FX.wh}/networks/${netId}`);
    expect(removed.status).toBe(200);
    expect((removed.body as { site: Site }).site.networks.map((n) => n.cidr)).not.toContain("203.0.113.0/24");
    expect((await del(admin, `/api/admin/sites/${FX.wh}/networks/${netId}`)).body.error).toBe("bad_request");
    expect((await del(admin, `/api/admin/sites/${FX.wh}/networks/x`, { origin: "https://evil.example" })).body.error).toBe("bad_origin");

    const audit = await auditFor(admin, netId);
    expect(audit.map((e) => e.action).sort()).toEqual(["network.add", "network.remove"]);
    await admin.close();
  });

  test("AC-31 sites and networks: the site page shows networks and the current IP, and adds a network", async ({ browser }) => {
    const admin = await signedIn(browser, FX.admin);
    await admin.setExtraHTTPHeaders({ "x-test-client-ip": FX.ip.inV4 });
    const page = await admin.newPage();
    await page.goto(`/admin/sites/${FX.hq}`);
    await expect(page.locator('li[data-cidr="198.51.100.0/24"]')).toBeVisible();
    await expect(page.locator("[data-my-ip]")).toHaveText(FX.ip.inV4);
    await page.getByLabel("cidr").fill("203.0.113.0/24");
    await page.getByRole("button", { name: "Add network" }).click();
    await expect(page.locator('li[data-cidr="203.0.113.0/24"]')).toBeVisible();
    await page.getByLabel("cidr").fill("10.1.0.0/16");
    await page.getByRole("button", { name: "Add network" }).click();
    await expect(page.locator('[data-error="cidr_not_public"]')).toBeVisible();
    await admin.close();
  });

  test("AC-31 sites and networks: employee -> forbidden on every /api/admin/*", async ({ browser }) => {
    // an ACTIVE employee: the owner demotes the admin
    const owner = await signedIn(browser, FX.owner);
    expect((await patch(owner, "/api/admin/members/m_admin", { role: "employee" })).status).toBe(200);
    const invited = await signedIn(browser, FX.emp1);
    const active = await signedIn(browser, FX.admin);
    const reads = ["/api/admin/members", "/api/admin/org", "/api/admin/audit", "/api/admin/sites", `/api/admin/sites/${FX.hq}`, "/api/admin/credentials?status=PENDING", "/api/admin/attendance", "/api/admin/attendance/export.csv", "/api/admin/attendance/verify", "/api/admin/anything"];
    const writes: ["post" | "patch" | "del", string][] = [
      ["post", "/api/admin/members"], ["patch", "/api/admin/members/m_emp2"], ["patch", "/api/admin/org"], ["post", "/api/admin/sites"],
      ["patch", `/api/admin/sites/${FX.hq}`], ["post", `/api/admin/sites/${FX.hq}/networks`], ["del", `/api/admin/sites/${FX.hq}/networks/net_hq_v4`],
      ["post", `/api/admin/sites/${FX.wh}/static-qr`], ["post", "/api/admin/static-qr/x/revoke"], ["post", "/api/admin/kiosks"], ["post", "/api/admin/kiosks/x/revoke"],
      ["post", "/api/admin/credentials/x/approve"], ["post", "/api/admin/credentials/x/reject"], ["post", "/api/admin/credentials/x/revoke"], ["post", "/api/admin/attendance/corrections"],
    ];
    const body = { name: "x", cidr: "203.0.113.0/24", email: "x@acme.test" };
    for (const ctx of [invited, active]) {
      for (const path of reads) {
        const r = await get(ctx, path);
        expect(r.status, path).toBe(403);
        expect(r.body.error, path).toBe("forbidden");
      }
      for (const [m, path] of writes) {
        const r = m === "del" ? await del(ctx, path) : m === "post" ? await post(ctx, path, body) : await patch(ctx, path, body);
        expect(r.status, path).toBe(403);
        expect(r.body.error, path).toBe("forbidden");
      }
    }
    // the site was not touched
    const site = await get<{ site: Site }>(owner, `/api/admin/sites/${FX.hq}`);
    expect(site.body.site.networks.map((n) => n.cidr)).toEqual(["198.51.100.0/24", "2001:db8:10::/48"]);
    for (const c of [owner, invited, active]) await c.close();
  });
});
