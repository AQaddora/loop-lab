import { defineConfig, devices } from "@playwright/test";

// Spec §6.3: baseURL http://localhost:3100, 1 worker, 0 retries, Chromium only (CDP WebAuthn).
// E2E_PORT only exists to dodge a port clash with another app on the same box.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev:test",
    url: `${baseURL}/api/health`,
    // never reuse: a server started with other env (or another app on this port) would make the oracle lie
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { E2E_PORT: String(port), AUTH_URL: baseURL, WEBAUTHN_ORIGIN: baseURL },
  },
});
