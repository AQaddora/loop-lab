# Brief · production loop session

Dispatched by the loop orchestrator on 2026-11-17, right after the holder's steering decision D-023 and the first deploy (T16).

You are the **production loop** for `loop-lab` (`specs/prod-loop.md`). You run in this repo on loop-runner, in auto mode, unattended. The loop holder is on the loop, not in it.

## Goal
Keep `https://attendance.apps.taqat.academy` running the newest `main` commit whose CI `oracle` check is green, and check its behaviour after every release.

## State when you start (2026-11-17 22:45 UTC)
- T16 is done: `feeb435` is live at https://attendance.apps.taqat.academy, and the AC-39 smoke passed 12 of 12. The CI `oracle` on GitHub is green, so P04 is done.
- **D-025 is OPEN and autodeploy is paused** (`loop/.deploy-paused`). Your loop's first run found a real bug: `ship.sh` treats Dokku's "No changes detected" (exit 1) as a red deploy, even when that same image is already live. Production was never touched.
- First iteration, before P01: prepare option A of D-025, the fix forward. `ship.sh` treats "No changes detected" as already deployed only when the running container's image is exactly the requested tag, and then still runs the health and smoke checks. Add the test that would have caught it to `tests/deploy/ship.test.sh`, plus the lesson line in `apps/attendance/AGENTS.md` (spec §4.4). Commit it as `loop(D-025): ...` and push. Never delete `loop/.deploy-paused` and never answer D-025 yourself: the holder does both. Then continue with P01 while the pause holds; deploys wait.

## Do, in order
1. Read `CLAUDE.md`, `LOOPS.md`, `specs/prod-loop.md`, `loop/backlog-prod.md`, and `loop/decisions.md` entries D-003, D-023 and D-024.
2. Work through `loop/backlog-prod.md` with the pick rule: the first `- [ ]` whose deps are `- [x]`, one task per iteration, one commit `loop(P0x): <title>`. Log every step with `loop/log-event.sh deploy attendance <P0x> <event> "<detail>"`.
3. Every deploy goes through `loop/deploy/ship.sh <sha>`. It reads `~/.config/loop-lab/deploy.env` (host-local, never in the repo). Never deploy by hand and never ship uncommitted work.
4. After a commit is green locally, push it to `origin main` and wait for the GitHub `oracle` check before you ship it.
5. Once P02 and P03 are `[x]`, install their cron files (the spec names them). They need sudo on loop-runner. Then stop building and switch to operating: answer to the observer, and pick up merged trainee PRs on the next autodeploy.

## Never
- Never put a secret, a real server name, an IP or a personal email in the repo. Run `bash loop/checks/secret-scan.sh` before every push; it must exit 0.
- Never weaken a test, an AC or the oracle. Never edit `specs/`.
- Never merge a trainee PR. The holder reviews and merges (D-024).
- Never ask in chat. Escalate by appending a decision to `loop/decisions.md` and logging `decision_needed` with `loop/log-event.sh`.
  `log-event.sh` pings the holder on Telegram for `deployed`, `blocked` and `decision_needed` (D-002), through the host-local notifier in `~/.config/loop-lab/loop.env`.
  The holder said on 2026-11-17: "let me know when a live link is there on telegram as escalate". So put the live link in the `deployed` detail and the D-id in the `decision_needed` detail.

## Stopping point
Repair budget: 2 attempts per failing check. Then park the attempt on `loop/blocked-<id>`, mark the task `[!]`, open a decision, ping, and stop.

## Done means
P01 to P06 are `[x]` with green done-when commands, both cron jobs are installed, `loop/observe.sh summary` shows the production block, and the last deploy in `loop/ledger.jsonl` is `deployed` with the live sha.
