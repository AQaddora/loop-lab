# Backlog · production loop (attendance)

Spec: `specs/prod-loop.md`. Marks: `- [ ]` todo · `- [x]` done · `- [!]` blocked (see `loop/decisions.md`).
Pick rule: the first `- [ ]` task in file order whose deps are all `- [x]`. One task = one iteration = one commit `loop(P01): <title>`.
Loop name for `loop/log-event.sh`: `deploy`, app `attendance`.
Global gate on top of each done-when: `npm --prefix apps/attendance run check` and `bash loop/checks/secret-scan.sh`.
Started by the loop holder's steering decision D-023 (2026-11-17). T16 in `loop/backlog-attendance.md` is the first deploy, and every P-task depends on it.

- [!] P01 · Health reports the deployed version — deps: T16 — done when: `npm --prefix apps/attendance test -- tests/unit/health-version.test.ts && curl -fsS https://attendance.apps.taqat.academy/api/health | grep -q '"version"'`
  PR-04. `GIT_SHA` build arg → env → `/api/health` `{ ok, version: sha12 }`. `smoke-remote.sh` also asserts `version` matches `--expect-version` when given.
  Code is on main (`loop(P01)` commit): the unit test passes, gate green. The done-when's `curl` needs this commit live, which waits on D-025 (autodeploy paused). `version` appears only when the image sets a 12-40 hex `GIT_SHA`, so dev/E2E/CI keep AC-01's exact `{"ok":true}`.
- [ ] P02 · Autodeploy: green main → apps-host, rollback on red smoke — deps: P01 — done when: `bash tests/deploy/autodeploy.test.sh && bash loop/deploy/autodeploy.sh --dry-run`
  PR-01, PR-02, PR-03. `loop/deploy/autodeploy.sh` per spec §4.1–4.2 (flock, state.json, `deploy/<ts>` tag, ledger `deployed`, fleet deployments.jsonl). Cron: `/etc/cron.d/loop-lab-autodeploy`, every 2 min.
- [ ] P03 · Production observer — deps: P02 — done when: `bash tests/deploy/observe.test.sh && bash loop/deploy/observe-prod.sh --once`
  PR-05, PR-06. O1–O7 from spec §4.3, state-change-only logging, pause plus decision on O3/O4/O5. Adds `apps/attendance/scripts/verify-chain.mjs` and the nightly backup. Cron: `/etc/cron.d/loop-lab-observe`, every 10 min.
- [x] P04 · CI oracle for trainee PRs + secret scan — deps: T16 — done when: `bash loop/checks/secret-scan.sh && gh run list -R AQaddora/loop-lab -w oracle -L 1 --json conclusion -q '.[0].conclusion' | grep -qx success`
  Done 2026-11-17 by the orchestrator seat: `secret-scan.sh` PASS, GitHub `oracle` run on 2a21bbe = success.
  PR-07, PR-08. `.github/workflows/oracle.yml` (pull_request + push to main; no secrets; Playwright Chromium), `loop/checks/secret-scan.sh`.
- [x] P05 · Protect main — deps: P04 — done when: `gh api repos/AQaddora/loop-lab/branches/main/protection -q '.required_status_checks.contexts[]' | grep -qx oracle`
  Done 2026-11-17 by the orchestrator seat when the repo went public: required check `oracle`, 1 CODEOWNER review for PRs, no force-push or deletion, enforce_admins off.
  PR-09, D-024. Required check `oracle`, a required CODEOWNER review for PRs, no force-push. The owner's loop commits are not blocked (enforce_admins off).
- [ ] P06 · observe.sh shows the production loop — deps: P03 — done when: `bash loop/observe.sh summary | grep -q 'production'`
  PR-10. One block: the live sha, the last deploy, paused or not, and the last red observer check.
