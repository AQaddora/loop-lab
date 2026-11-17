# Production loop · attendance

Owner: the loop holder (Ahmed Qaddoura). Status: **active**, started live on 2026-11-17 by decision D-023.
Agents never edit this file (CLAUDE.md rule 4). If it is wrong or missing something, open a decision.

## 0. Why this loop exists

The build loop (`specs/attendance.md` + `loop/backlog-attendance.md`) has one oracle: **the tests are green**. It merged 19 of 20 tasks without a human, then stopped at T16, the deploy. Green tests describe a version on a laptop. They do not tell you whether the running version still works.

The workshop's five stations are **Task → Agent → Review → Deploy → Lesson**. The build loop covers the first three. This loop covers the last two: *Deploy · verify the running version* and *Lesson · improve the next task*. Its oracle is **production itself**.

The loop holder steered the build loop into this one (D-023). Steering is a human act: the holder changed what "done" means. The agents didn't.

## 1. Goal

`https://attendance.apps.taqat.academy` runs the newest `main` commit whose CI oracle is green. Its behaviour is checked after every release and on a schedule. Every anomaly ends in one of three places: an automatic rollback, a ledger event, or a holder decision.

## 2. The six parts (CLAUDE.md, LOOPS.md)

| Part | This loop |
|---|---|
| Goal | §1, plus the production ACs in §5 (PR-01 … PR-10) |
| Act | Ship one green `main` commit: build the image on loop-runner, ship it to apps-host, deploy it with `dokku git:from-image` |
| Check | `apps/attendance/scripts/smoke-remote.sh` (AC-39) after each deploy. The observer (§4.3) runs every 10 min |
| Stop | A failed smoke rolls back to the previous image and pauses the loop. Two failed deploys in a row create `loop/.deploy-paused` and open a decision. The loop never ships a red or unreviewed commit |
| Memory | `loop/ledger.jsonl` (loop `deploy`), `loop/deploy/state.json`, git tags `deploy/<UTC timestamp>`, and the fleet `$FLEET_DEPLOYMENTS_LOG (optional)` |
| Escalate | `loop/decisions.md`, plus Telegram once D-002 is answered |

## 3. Topology (decided in D-003)

| Thing | Value |
|---|---|
| Public origin | `https://attendance.apps.taqat.academy` (own origin, `BASE_PATH` empty) |
| Host | apps-host, Dokku app `attendance`, nginx and Let's Encrypt from Dokku |
| Client IP | Dokku's nginx sets `X-Forwarded-For $remote_addr`, so `TRUSTED_IP_HEADER` is empty and `TRUSTED_PROXY_HOPS=1` |
| DB | SQLite at `/data/attendance.db` on the Dokku storage mount `/var/lib/dokku/data/storage/attendance` |
| Build | `docker build` on loop-runner from `apps/attendance/Dockerfile`, then `docker save \| ssh apps-host docker load`. The TAQAT box never compiles |
| Secrets | Only in the Dokku app config and `~/.config/loop-lab/secrets/attendance-prod.env` (mode 600). Never in the repo, ledger, decisions, logs or chat (CLAUDE.md rule 9) |
| Owner account | `BOOTSTRAP_OWNER_EMAIL` lives in the Dokku config only. It is the holder's Google account |
| Source of `main` | GitHub `AQaddora/loop-lab` (public). Trainees fork it and open PRs. A merge needs the CI oracle and a CODEOWNER review (D-024) |

## 4. Behaviour

### 4.1 Deploy (autodeploy, every 2 min, on loop-runner)

1. `git fetch origin main`. Do nothing if `origin/main` equals the last deployed sha in `loop/deploy/state.json`.
2. Wait until the commit's GitHub check `oracle` is `success`. A pending check means wait. On a red check, log `blocked "ci red <sha>"` once and do not deploy.
3. Build the image `loop-lab-attendance:<sha12>` with build arg `GIT_SHA=<sha>`.
4. Ship it, run `dokku git:from-image attendance loop-lab-attendance:<sha12>`, and wait until `/api/health` reports `version == <sha12>` (90 s timeout).
5. Run `smoke-remote.sh https://attendance.apps.taqat.academy`.
   - Green: write state, tag `deploy/<ts>`, log `deployed "<sha12>"`, and append a fleet deployments line.
   - Red: redeploy the previous image, log `test_fail` and then `blocked`, and write `loop/.deploy-paused` with the reason.
6. While `loop/.deploy-paused` exists, steps 3–5 never run. Only the holder deletes it, after answering the decision that the pause opened.

### 4.2 Lock and safety

- One deploy at a time (`flock loop/deploy/.lock`).
- The deploy never touches the DB file except through the app's own migrations at boot. The observer backs the DB up (§4.3) and keeps 14 copies on apps-host.
- The deploy never runs `dokku apps:destroy`, `storage:unmount` or `config:unset` on secrets. Those are holder actions.
- `AUTH_TEST_MODE` is never set in production. `assert-prod-env.mjs` refuses to boot if it is, and the smoke test proves the bypass is dead (AC-36, AC-39).

### 4.3 Observe (every 10 min, on loop-runner)

Checks, each logged only when its state changes (no noise):

| Id | Check | Red means |
|---|---|---|
| O1 | `GET /api/health` returns 200 and `version` equals the deployed sha | down, or drifted from what the ledger says is live |
| O2 | TLS certificate valid for more than 14 days | renewal is broken |
| O3 | AC-39 spoof check: a spoofed `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` / `Fly-Client-IP` never comes back from `/api/client-ip` | the IP gate can be faked: page the holder at once |
| O4 | `/api/test/*` is 404 and there is no `test-login` provider | a test bypass is reachable in production: page the holder at once |
| O5 | Chain verify inside the container (`node scripts/verify-chain.mjs`) | the attendance log was edited or cut |
| O6 | Error lines in `dokku logs attendance` over the window are at most 20 | the app is throwing |
| O7 | The nightly SQLite backup exists and is not empty | the data is not protected |

An O3, O4 or O5 failure opens a decision at once and pauses autodeploy. An O1, O2, O6 or O7 failure that is still red after 3 runs opens a decision.

### 4.4 Lesson (the fifth station)

When a production check catches something the build oracle missed, the loop does not just fix it. It also adds, in the same task, a test that would have caught it in CI, and a one-line rule with a reason in `apps/attendance/AGENTS.md`: what happened, the rule, why, and how it is checked. The next task learns from the last.

## 5. Production acceptance criteria

| AC | Criterion | Test |
|---|---|---|
| PR-01 | A green `main` commit is live within 15 min of its CI turning green, with no human step | `loop/deploy/autodeploy.sh --dry-run` reports the plan; the ledger has `deployed` for that sha |
| PR-02 | A red or pending CI commit is never deployed | `tests/deploy/autodeploy.test.sh` with a stubbed `gh` |
| PR-03 | A failed smoke rolls back to the previous image and writes `loop/.deploy-paused` | `tests/deploy/autodeploy.test.sh` with a stubbed smoke |
| PR-04 | `/api/health` reports `{ ok, version }`, where `version` is the image's `GIT_SHA` (12 chars) | unit test + `smoke-remote.sh` |
| PR-05 | The observer logs only state changes, and O3/O4/O5 pause autodeploy and open a decision | `tests/deploy/observe.test.sh` with stubbed curl |
| PR-06 | A nightly DB backup exists on apps-host, with 14 kept | observer O7 |
| PR-07 | No secret value appears in the repo, the ledger, decisions, CI logs or deploy logs | `loop/checks/secret-scan.sh` in CI and before every push |
| PR-08 | Trainee PRs run the full oracle in CI (lint, typecheck, unit, AC coverage, E2E, prod guard) with no secrets, on `pull_request` only (never `pull_request_target`) | `.github/workflows/oracle.yml` |
| PR-09 | `main` is protected: the `oracle` check is required, a CODEOWNER review is required for PRs, and force-push is off | `gh api repos/AQaddora/loop-lab/branches/main/protection` |
| PR-10 | `loop/observe.sh summary` shows the production loop: live sha, last deploy, paused or not, and the last red check | manual |

## 6. Roles

- **Loop holder** (Ahmed): steers. Approves trainee PRs (D-024), answers decisions, and is the only one who deletes `loop/.deploy-paused`.
- **Production loop** (an agent session plus two cron jobs on loop-runner): builds the P-tasks in `loop/backlog-prod.md`, then operates. It never asks in chat.
- **Trainees and their agents**: fork, take an open task or issue, and open a PR whose description carries the evidence (CONTRIBUTING.md). The CI oracle is their first reviewer, and the holder is the last.

## 7. Open decisions for this loop

| Id | Question | Default until answered |
|---|---|---|
| D-002 | Telegram pings? | Off. Escalation goes only to `loop/decisions.md` |
| D-010 | External anchoring of the log head hash? | None. O5 verifies only inside the box |
