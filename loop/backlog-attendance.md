# Backlog · attendance

Spec: `specs/attendance.md` (§ refs below). Marks: `- [ ]` todo · `- [x]` done · `- [!]` blocked (see `loop/decisions.md`).
Pick rule: take the first `- [ ]` task in **file order** whose deps are all `- [x]`. One task = one iteration = one PR.
Ids are stable and never renumbered: a task added later takes the next free id (T17+) and sits where it must run, so file order is build order.
Global gate for every task, on top of its own done-when: `npm --prefix apps/attendance run check` (lint + typecheck + all unit tests).
Every task after T17 starts its done-when with `scripts/check-ac-coverage.sh <its ACs>`, so none of the task's ACs can stay untested. E2E tasks then run the **whole** E2E suite, so a regression in an earlier AC turns the task red.
A done-when must FAIL before the work and PASS after. Never skip or weaken an AC test to go green (spec §7.5).
The spec was revised on 2026-11-17 by an adversarial review after T01–T05 had merged. T18 brings the merged primitives up to the revised ACs. T06 was in flight and keeps its line.

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
- [x] T06 · Auth.js (Google + allowlist policy) + test harness + prod guard — deps: T02, T03 — done when: `npm --prefix apps/attendance run e2e -- --grep "AC-(10|11)\b" && bash apps/attendance/scripts/check-prod-no-test-mode.sh`
  src/auth.ts: Google + gated `test-login`, JWT 12 h, one signIn policy for both (§2.3); /api/test/{reset,login,clock,qr,tamper} return 404 unless isTestMode(); fixture §7.3.
  e2e/helpers/api.ts (reset, loginAs, setClock, mintQr); scripts/check-prod-no-test-mode.sh per §7.4. AC-10, AC-11, AC-36.
- [x] T17 · AC coverage guard script — deps: T02 — done when: `npm --prefix apps/attendance test -- tests/unit/ac-coverage.test.ts && bash apps/attendance/scripts/check-ac-coverage.sh AC-01 AC-08 AC-40`
  scripts/check-ac-coverage.sh per spec §7.5: resolves paths from its own dir; AC ids from the §8 table (`SPEC=` override); titles in `test(` / `it(` / `describe(` under tests/ + e2e/ (`TEST_DIRS=` override).
  Script ACs (AC-36, AC-39) need their script to contain the id; no args = all except AC-39; always fails on .skip( .only( .fixme( test.todo xit( xdescribe( test.fail( passWithNoTests.
  tests/unit/ac-coverage.test.ts drives it against temp fixture dirs. AC-40.
- [x] T18 · Bring merged primitives up to the revised spec — deps: T17 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-03 AC-04 AC-05 AC-06 AC-07 AC-28 && ls apps/attendance/tests/unit/ip-policy.test.ts apps/attendance/tests/unit/qr-mode.test.ts apps/attendance/tests/unit/chain-anchor.test.ts apps/attendance/tests/unit/punch-state-stale.test.ts apps/attendance/tests/unit/db-retention.test.ts && npm --prefix apps/attendance test -- tests/unit/ip-policy.test.ts tests/unit/qr-mode.test.ts tests/unit/chain-anchor.test.ts tests/unit/punch-state-stale.test.ts tests/unit/db-retention.test.ts`
  ip.ts parseCidr(): `cidr_too_broad` (/0, v4 < /16, v6 < /32), `cidr_not_public` (range list in §2.2; documentation ranges accepted). qr.ts: token prefix must match site.qrMode (§2.1 verify block).
  chain.ts: `verifyChain(rows, key, {anchor})` = past checkpoint: fails at anchor.seq if that row is missing or its hash differs; later rows are fine (§2.6 tail cut). punch-state.ts: an IN older than its site's max_shift_hours counts as OUT.
  Migration 0002: sites.max_shift_hours (16), webauthn_challenges.kind, update triggers that allow only ip/ua → NULL (§2.6). New tests titled with their AC id; existing tests untouched. AC-03..07, AC-28.
- [ ] T07 · Admin foundation: Origin check, audit, bootstrap setup, org, members — deps: T06, T17 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-33 AC-42 AC-43 && npm --prefix apps/attendance run e2e`
  src/lib/origin.ts (Origin required, missing = bad_origin, JSON only, /api/test/* exempt; §2.7), src/lib/audit.ts, admin authz helper, admin-write rate limit. e2e helpers send Origin on every write.
  Sign-in policy step 0 + /admin/setup + /api/admin/setup (only while no org exists), PATCH /api/admin/org (owner); add `{fixture:'empty'}` to /api/test/reset if T06 did not.
  /admin/members + /api/admin/members[/id]: one or an array; code/status/email edits; owner-only role grants; no self role/status change; last-owner guard; google_sub never writable (§1.1.3). AC-33, AC-42, AC-43.
- [ ] T19 · Admin sites + networks — deps: T07, T18 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-31 && npm --prefix apps/attendance run e2e`
  /admin/sites/[id] + /api/admin/sites[/id]: timezone, qr_mode, rotation 10–120, grace 0–2, status ACTIVE/DISABLED, key-version bump; networks POST/DELETE through parseCidr(); "your current IP" from /api/client-ip.
  Every write audited and Origin-checked; employee → `forbidden` on every /api/admin/*. AC-31.
- [ ] T08 · QR scan entry + scan tickets + static QR + security headers — deps: T19 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-12 AC-13 AC-14 AC-15 AC-38 && npm --prefix apps/attendance run e2e`
  GET /s/[siteId]?t= → rate limit → IP → token (§2.1 verify block; unknown site qr_invalid, DISABLED qr_revoked) → scan_tickets row + HttpOnly `scan_ticket` cookie (Max-Age = TTL, Path §2.7) → 303 /punch; `<main data-error>` page.
  Static QR: POST /api/admin/sites/[id]/static-qr (TTL ≤ 30 d else ttl_too_long), printable /admin/sites/[id]/qr/[qrId], revoke. src/proxy.ts CSP nonce + headers (§2.7). /s/* + /api/client-ip rate limits (office-IP allowance).
  AC-14 freezes the clock: add `{fixedMs}` to /api/test/clock if T06 did not. AC-12, AC-13, AC-14, AC-15, AC-38.
- [ ] T09 · Onboarding profile + passkey registration (PENDING) — deps: T08 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-16 AC-17 AC-18 AC-35 && npm --prefix apps/attendance run e2e`
  /onboarding + POST /api/profile (§1.3.4); /enroll + /api/webauthn/register/{options,verify} exactly as §2.4: binds the ticket, IP checked at both steps, an older PENDING superseded, synced policy from orgs.
  Waiting screen shows `data-confirm-code` from /api/me/state. e2e/helpers/webauthn.ts + the registration half of e2e/helpers/ceremony.ts (UV `discouraged` override for AC-18, §7.1). AC-16, AC-17, AC-18, AC-35.
- [ ] T10 · Admin credential approvals with confirm code (approve / reject / revoke) — deps: T09 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-20 && npm --prefix apps/attendance run e2e`
  /admin/credentials queue shows UA, IP, site, time, AAGUID and the synced flag, never the confirm code; approve body `{confirmCode}`; one tx: previous APPROVED → REVOKED, then target → APPROVED.
  State rules + codes per §2.4 (`invalid_state`, `forbidden_self_action`, `confirm_code_mismatch`); every decision goes to audit_log. AC-20.
- [ ] T11 · Check-in / check-out (punch) + atomic commit + /me history — deps: T10, T18 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-19 AC-21 AC-22 AC-27 AC-41 && npm --prefix apps/attendance test -- tests/unit/punch-commit.test.ts && npm --prefix apps/attendance run e2e`
  /api/punch/options (steps 1, 2, 3, 5, 6; challenge bound to member + ticket + kind) + /api/punch running §2.5 in its exact order; steps 9–10 = `commitPunch()` in src/lib/punch.ts, one synchronous tx with no `await`.
  /punch shows the one valid action; /me + /api/me/events; the punch half of e2e/helpers/ceremony.ts. AC-19, AC-21, AC-22, AC-27, AC-41.
- [ ] T20 · Punch abuse: replay, tickets, IP re-check, rate limits — deps: T11 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-23 AC-24 AC-25 AC-34 && npm --prefix apps/attendance run e2e`
  e2e/abuse.spec.ts: challenge reuse / expiry / kind mismatch; counter regression (CDP removeCredential + addCredential with signCount 0); ticket reuse, copy and absence; IP switch; both rate-limit rows of §2.7.
  Fix what they expose in app code (e.g. the library's counter error → `counter_regression` + audit), never in tests. AC-23, AC-24, AC-25, AC-34.
- [ ] T12 · New-device re-registration on the same Google account — deps: T11 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-26 && npm --prefix apps/attendance run e2e`
  /punch "New phone / passkey deleted" → /enroll even when an APPROVED credential exists; at most one PENDING (a newer one supersedes the older); flow §1.5.
  Test: new browser context + empty virtual authenticator + same email, approved with that context's confirm code; the old context proves `credential_revoked`. AC-26.
- [ ] T13 · Kiosk pairing + rotating QR display — deps: T08 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-32 && npm --prefix apps/attendance run e2e`
  POST /api/admin/kiosks → 8-char one-time pairing code (10 min, hashed) → /kiosk/pair → POST /api/kiosk/pair (site IP only, 10/min per IP) → HttpOnly kiosk cookie (180 d, token hashed).
  /kiosk polls GET /api/kiosk/token (site IP only, returns serverNow) and hides the QR by server time (§1.2); `data-token` + `data-url`. The test drives page.clock + setClock, never real sleeps. AC-32.
- [ ] T14 · Admin corrections, CSV export, chain verify — deps: T11 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-29 AC-30 && npm --prefix apps/attendance run e2e`
  POST /api/admin/attendance/corrections (VOID / IN / OUT rules in §2.6, reason 3–500 chars, no self-correction); GET export.csv with formula escaping; GET verify → `{ok, firstBadSeq}`; /admin/attendance UI.
  AC-29 uses /api/test/tamper. AC-29, AC-30.
- [ ] T15 · Full E2E journey + whole-suite convergence — deps: T12, T13, T14, T20 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh && npm --prefix apps/attendance run check && npm --prefix apps/attendance run e2e && bash apps/attendance/scripts/check-prod-no-test-mode.sh`
  e2e/journey.spec.ts (AC-37) from the `empty` fixture: admin steps via /api/admin/*, employee steps via the UI, `test-login` stands in for Google. Fix whatever it exposes in app code, not in tests.
  No-arg coverage = every AC in spec §8 except AC-39. AC-37.
- [!] T16 · Staging deploy (HTTPS) + remote smoke — deps: T15 — done when: `bash apps/attendance/scripts/check-ac-coverage.sh AC-39 && bash apps/attendance/scripts/smoke-remote.sh "$(cat apps/attendance/deploy/STAGING_URL)"`
  BLOCKED on the loop holder: deploy target + client-IP header + staging origin (spec OD-1) and the Google OAuth client + secrets (spec OD-2). See loop/decisions.md.
  Prod build only (`next build` + `npm start`), AUTH_TEST_MODE unset; the proxy overwrites the IP header and the app port is firewalled; write the URL to apps/attendance/deploy/STAGING_URL.
  smoke-remote.sh (`# AC-39`) = spec AC-39, including the spoofed-header and open-port checks.
