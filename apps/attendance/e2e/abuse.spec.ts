import { expect, test } from "@playwright/test";
import { BASE_URL, FX, patch, post, reset, signedIn } from "./helpers/api";

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
});
