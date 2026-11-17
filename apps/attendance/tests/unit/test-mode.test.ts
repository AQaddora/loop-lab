import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTestMode } from "@/lib/test-mode";

const APP = path.resolve(__dirname, "../..");
const GUARD = path.join(APP, "scripts/assert-prod-env.mjs");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const REQUIRED_ENV = {
  AUTH_SECRET: "x".repeat(32),
  QR_SIGNING_SECRET: "y".repeat(32),
  LOG_CHAIN_KEY: "z".repeat(32),
  WEBAUTHN_RP_ID: "example.test",
  WEBAUTHN_ORIGIN: "https://example.test",
};

/** Run the guard in an empty dir (no .env files) with exactly this env. */
function runGuard(env: Record<string, string>) {
  const cwd = mkdtempSync(path.join(tmpdir(), "assert-prod-env-"));
  try {
    return spawnSync(process.execPath, [GUARD], {
      cwd,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" as const, ...env },
      encoding: "utf8",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("AC-08 gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("AC-08 gate: isTestMode() is true only with AUTH_TEST_MODE=1 and NODE_ENV != production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_TEST_MODE", "1");
    expect(isTestMode()).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    expect(isTestMode()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isTestMode()).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    for (const v of ["", "0", "true", "yes", "1 ", " 1"]) {
      vi.stubEnv("AUTH_TEST_MODE", v);
      expect(isTestMode(), `AUTH_TEST_MODE=${JSON.stringify(v)}`).toBe(false);
    }
    vi.stubEnv("AUTH_TEST_MODE", undefined);
    expect(isTestMode()).toBe(false);
  });

  it("AC-08 gate: inside src/, AUTH_TEST_MODE appears only in lib/test-mode.ts and instrumentation.ts", () => {
    const src = path.join(APP, "src");
    const hits = walk(src)
      .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("AUTH_TEST_MODE"))
      .map((f) => path.relative(APP, f).split(path.sep).join("/"))
      .sort();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h === "src/lib/test-mode.ts" || h === "src/instrumentation.ts")).toBe(true);
    expect(hits).toContain("src/lib/test-mode.ts");
  });

  it("AC-08 gate: scripts/assert-prod-env.mjs exits 1 when AUTH_TEST_MODE is set", () => {
    const ok = runGuard(REQUIRED_ENV);
    expect(ok.status, ok.stderr).toBe(0);

    for (const v of ["1", "0", "true"]) {
      const r = runGuard({ ...REQUIRED_ENV, AUTH_TEST_MODE: v });
      expect(r.status, `AUTH_TEST_MODE=${v}`).toBe(1);
    }
  });

  it("AC-08 gate: scripts/assert-prod-env.mjs exits 1 when a required var is missing", () => {
    for (const name of Object.keys(REQUIRED_ENV)) {
      const env: Record<string, string> = { ...REQUIRED_ENV };
      delete env[name];
      const r = runGuard(env);
      expect(r.status, `missing ${name}`).toBe(1);
    }
  });

  it("AC-08 gate: npm start runs the guard before next start", () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
    expect(pkg.scripts.start).toMatch(/^node scripts\/assert-prod-env\.mjs && next start\b/);
  });
});
