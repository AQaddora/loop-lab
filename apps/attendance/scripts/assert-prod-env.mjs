#!/usr/bin/env node
// Production boot guard (spec §6.4, TH-14). Runs before `next start` (see `npm start`).
// Exits 1 if AUTH_TEST_MODE is set (any non-empty value) or a required secret/config is missing.
// It loads env files the way `next start` will (.env.production.local, .env.local, .env.production, .env
// from the current directory), so the guard sees the same values the server will.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
} catch {
  // @next/env missing: fall back to the process env only
}

const REQUIRED = ["AUTH_SECRET", "QR_SIGNING_SECRET", "LOG_CHAIN_KEY", "WEBAUTHN_RP_ID", "WEBAUTHN_ORIGIN"];
const problems = [];

if ((process.env.AUTH_TEST_MODE ?? "") !== "") {
  problems.push("AUTH_TEST_MODE is set: production refuses to boot with test mode (spec TH-14)");
}
for (const name of REQUIRED) {
  if ((process.env[name] ?? "").trim() === "") problems.push(`${name} is missing`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`assert-prod-env: ${p}`);
  process.exit(1);
}
console.log("assert-prod-env: ok");
