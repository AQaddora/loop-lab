import { chromium, type FullConfig } from "@playwright/test";

/**
 * `next dev` compiles routes lazily, and a compile can make the dev HMR client reload pages that are open in
 * other tests (an in-flight page.evaluate then dies with "execution context was destroyed"). Warm every route
 * once, server and client side, before the first test, so the oracle measures the app, not the compiler.
 */
const PAGES = ["/", "/signin", "/onboarding", "/enroll", "/punch", "/me", "/admin", "/admin/setup", "/admin/members", "/admin/credentials", "/admin/kiosks", "/admin/sites/site_hq", "/admin/sites/site_wh/qr/x", "/kiosk", "/kiosk/pair?code=AAAAAAAA"];
const APIS: [string, string][] = [
  ["GET", "/api/health"], ["GET", "/api/client-ip"], ["GET", "/api/auth/session"], ["GET", "/api/auth/providers"],
  ["GET", "/api/me/state"], ["GET", "/api/me/events"], ["POST", "/api/profile"], ["POST", "/api/webauthn/register/options"],
  ["POST", "/api/webauthn/register/verify"], ["POST", "/api/punch/options"], ["POST", "/api/punch"], ["GET", "/api/kiosk/token"],
  ["POST", "/api/kiosk/pair"], ["GET", "/s/site_hq?t=x"], ["GET", "/api/admin/members"], ["PATCH", "/api/admin/members/x"],
  ["GET", "/api/admin/org"], ["POST", "/api/admin/setup"], ["GET", "/api/admin/audit"], ["GET", "/api/admin/sites"],
  ["GET", "/api/admin/sites/site_hq"], ["POST", "/api/admin/sites/site_hq/networks"], ["DELETE", "/api/admin/sites/site_hq/networks/x"],
  ["POST", "/api/admin/sites/site_wh/static-qr"], ["POST", "/api/admin/static-qr/x/revoke"], ["GET", "/api/admin/credentials"],
  ["POST", "/api/admin/credentials/x/approve"], ["GET", "/api/admin/kiosks"], ["POST", "/api/admin/kiosks/x/revoke"],
  ["GET", "/api/admin/attendance/verify"], ["GET", "/api/admin/anything"], ["POST", "/api/test/reset"],
];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  for (const [method, path] of APIS) {
    await ctx.request.fetch(path, { method, headers: { "content-type": "application/json", origin: baseURL }, data: "{}", maxRedirects: 0 }).catch(() => undefined);
  }
  await ctx.request.post("/api/test/reset", { data: {} });
  await ctx.request.post("/api/test/login", { data: { email: "admin@acme.test" } });
  const page = await ctx.newPage();
  for (const path of PAGES) {
    await page.goto(path, { waitUntil: "networkidle" }).catch(() => undefined);
  }
  await browser.close();
  // leave a clean fixture behind; each test resets again anyway
  const clean = await chromium.launch();
  const c2 = await clean.newContext({ baseURL });
  await c2.request.post("/api/test/reset", { data: {} });
  await clean.close();
}
