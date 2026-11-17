# Backlog · attendance

Spec: `specs/attendance.md` (§ refs below). Marks: `- [ ]` todo · `- [x]` done · `- [!]` blocked (see `loop/decisions.md`).
Pick rule: take the first `- [ ]` task whose deps are all `- [x]`. One task = one iteration = one PR.
Global gate for every task, on top of its own done-when: `npm --prefix apps/attendance run check` (lint + typecheck + all unit tests).
A done-when must FAIL before the work and PASS after. Never skip or weaken an AC test to go green (spec §7.5).

- [x] T01 · Scaffold Next.js app + Vitest + Playwright + smoke test — deps: none — done when: `npm --prefix apps/attendance run check && npm --prefix apps/attendance run e2e -- --grep "AC-01\b"`
  Non-interactive create-next-app in apps/attendance (TS strict, App Router, src/, ESLint, npm); scripts per §6.3 (no db:migrate yet); `.env.example` + `.env.e2e` per §6.4.
  `GET /api/health` → `{"ok":true}`; tests/unit/sanity.test.ts; Playwright Chromium-only per §6.3, webServer `npm run dev:test` on :3100; `npx playwright install chromium`.
  AC-01.
- [x] T02 · Test-mode gate, injectable server clock, prod boot guard — deps: T01 — done when: `npm --prefix apps/attendance test -- tests/unit/test-mode.test.ts`
  src/lib/test-mode.ts `isTestMode()` (§7.2), src/lib/clock.ts `now()` with test offset on globalThis, src/instrumentation.ts + scripts/assert-prod-env.mjs (§6.4); `start` = guard && next start.
  AC-08.
- [x] T03 · Drizzle schema + migrations (SQLite) + append-only triggers — deps: T01 — done when: `npm --prefix apps/attendance run typecheck && npm --prefix apps/attendance test -- tests/unit/db-append-only.test.ts`
  All tables, columns, statuses and partial unique indexes from §4 in src/db/schema.ts; custom migration adds BEFORE UPDATE/DELETE triggers on attendance_events + audit_log.
  tests/helpers/db.ts = fresh in-memory DB with migrations; add db:generate/db:migrate and wire migrate into dev:test. AC-28.
- [x] T04 · Client IP + CIDR allowlist + QR token primitives — deps: T02 — done when: `npm --prefix apps/attendance test -- tests/unit/ip.test.ts tests/unit/qr.test.ts`
  src/lib/ip.ts `clientIp(headers)` + `ipAllowed(ip, cidrs)` via ipaddr.js (§2.2); src/lib/qr.ts mint/verify rotating + static with HMAC-SHA256 + timingSafeEqual (§2.1).
  Pure functions, clock injected. AC-02, AC-03, AC-04, AC-05.
- [x] T05 · Hash chain, punch state machine, rate limiter — deps: T03 — done when: `npm --prefix apps/attendance test -- tests/unit/chain.test.ts tests/unit/punch-state.test.ts tests/unit/ratelimit.test.ts`
  src/lib/chain.ts: canonical JSON + HMAC(LOG_CHAIN_KEY) + `verifyChain()` → first bad seq (§2.6); src/lib/punch-state.ts, pure (§2.5 step 9); src/lib/ratelimit.ts, DB fixed window (§2.7).
  AC-06, AC-07, AC-09.
- [ ] T06 · Auth.js (Google + allowlist policy) + test harness + prod guard — deps: T02, T03 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-(10|11)\b" && bash apps/attendance/scripts/check-prod-no-test-mode.sh`
  src/auth.ts: Google + gated `test-login`, JWT 12 h, one signIn policy for both (§2.3); /api/test/{reset,login,clock,qr,tamper} return 404 unless isTestMode(); fixture §7.3.
  e2e/helpers/api.ts (reset, loginAs, setClock, mintQr); scripts/check-prod-no-test-mode.sh per §7.4. AC-10, AC-11, AC-36.
- [ ] T07 · Admin: bootstrap owner, members allowlist, sites, networks, audit log — deps: T04, T06 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-31\b"`
  /admin/setup (BOOTSTRAP_OWNER_EMAIL), /admin/members, /admin/sites/[id] + the matching /api/admin/* routes (§5.2); src/lib/origin.ts check on every write; src/lib/audit.ts on every write.
  Invalid CIDR → `cidr_invalid`; employee role → `forbidden` on all /api/admin/*. AC-31.
- [ ] T08 · QR scan entry + scan tickets + static QR mint/print/revoke — deps: T04, T07 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-(12|13|14|15)\b"`
  GET /s/[siteId]?t= → IP check, then token (§2.1–2.2) → scan_tickets row + HttpOnly `scan_ticket` cookie → redirect /punch; error page `<main data-error>`; Referrer-Policy no-referrer.
  Static QR: POST /api/admin/sites/[id]/static-qr (TTL), printable /admin/sites/[id]/qr/[qrId], revoke. AC-12, AC-13, AC-14, AC-15.
- [ ] T09 · Onboarding profile + passkey registration (PENDING) — deps: T08 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-(16|17|18|35)\b"`
  /onboarding + POST /api/profile (code must match allowlist); /enroll + /api/webauthn/register/{options,verify} exactly as §2.4; needs live ticket + allowed IP; synced policy from orgs.
  e2e/helpers/webauthn.ts CDP virtual authenticator (§7.1). AC-16, AC-17, AC-18, AC-35.
- [ ] T10 · Admin credential approvals (approve / reject / revoke) — deps: T09 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-20\b"`
  /admin/credentials queue shows UA, IP, site, time, AAGUID, synced flag; approve = one tx: target → APPROVED, member's previous APPROVED → REVOKED.
  No self-approval (`forbidden_self_action`); every decision goes to audit_log. AC-20.
- [ ] T11 · Check-in / check-out (punch) + hash-chained log + /me history — deps: T05, T10 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-(19|21|22|27)\b"`
  /api/punch/options (discoverable, UV required) + /api/punch running the checks in the exact §2.5 order; step 10 is one transaction (event via chain.ts, ticket used, counter, chain head).
  /punch shows the one valid action; /me + /api/me/events; e2e/helpers/ceremony.ts (§7.1). AC-19, AC-21, AC-22, AC-27.
- [ ] T12 · New-device re-registration on the same Google account — deps: T11 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-26\b"`
  /punch "New phone / passkey deleted" → /enroll even when an APPROVED credential exists; at most one PENDING (a newer one rejects the older); flow §1.5.
  Test: new browser context + empty virtual authenticator + same email; old context proves `credential_revoked` after approval. AC-26.
- [ ] T13 · Kiosk pairing + rotating QR display — deps: T08 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-32\b"`
  POST /api/admin/kiosks → one-time pairing code (10 min, hashed) → /kiosk/pair sets HttpOnly kiosk cookie (180 d, token hashed); /kiosk polls GET /api/kiosk/token (§1.2).
  QR rendered client-side with `qrcode`, `data-token` + `data-url` attrs; QR hidden when the token expires; revoked kiosk → `kiosk_unauthorized`. AC-32.
- [ ] T14 · Admin corrections, CSV export, chain verify — deps: T11 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-(29|30)\b"`
  POST /api/admin/attendance/corrections (VOID / IN / OUT, effective_at, reason required, no self-correction); GET export.csv; GET verify → `{ok, firstBadSeq}`; /admin/attendance UI.
  AC-29 uses /api/test/tamper. AC-29, AC-30.
- [ ] T15 · Abuse suite + full E2E journey (everything green) — deps: T12, T13, T14 — done when: `npm --prefix apps/attendance run check && npm --prefix apps/attendance run e2e && bash apps/attendance/scripts/check-prod-no-test-mode.sh && bash apps/attendance/scripts/check-ac-coverage.sh`
  Complete e2e/abuse.spec.ts (AC-23, AC-24, AC-25, AC-33, AC-34, AC-38) + e2e/journey.spec.ts (AC-37); fix whatever they expose in app code, not in tests.
  scripts/check-ac-coverage.sh: every AC-01..AC-38 in the spec has a test titled with its id, and there are no .skip/.only/.fixme.
- [!] T16 · Staging deploy (HTTPS) + remote smoke — deps: T15 — done when: `bash apps/attendance/scripts/smoke-remote.sh "$(cat apps/attendance/deploy/STAGING_URL)"`
  BLOCKED on the loop holder: deploy target + client-IP header + staging domain (spec OD-1) and the Google OAuth client + secrets (spec OD-2). See loop/decisions.md.
  Prod build only (`next build` + `npm start`), AUTH_TEST_MODE unset; write the URL to apps/attendance/deploy/STAGING_URL; smoke = AC-39.
