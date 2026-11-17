# Brief · attendance build loop

Written by the orchestrator and sent at 11:48:07 UTC on 2026-11-17 to a new session titled
"Attendance build loop (T01 onward)". The holder had chosen "New session" on the session card 19 seconds earlier.
Server names and paths are replaced by public aliases (see [README](../README.md)); nothing else is changed.

What came of it: 19 of 20 backlog tasks merged between 11:54 and 13:32 UTC, one `loop(Txx)` commit each,
from `1cca1e4` (T01) to `5be44a6` (T15). T16, the deploy, stopped as blocked at 13:33 (`loop/ledger.jsonl`).
See [02-prepared-prompts.md](../02-prepared-prompts.md#2-attendance-build-loop-brief).

## Prompt

````text
You are the ATTENDANCE BUILD LOOP for loop-lab in `~/loop-lab`. Build the attendance app one backlog task at a time, from `loop/backlog-attendance.md`, following `specs/attendance.md`. The spec is the source of truth: acceptance criteria AC-xx, threat model, data model, stack, test oracle.

Each iteration:
1. Pick the first unticked task (`- [ ]`) whose deps are all ticked.
2. Run `loop/log-event.sh feature attendance <id> start "<title>"`. Check `loop/log-event.sh` for its exact args first.
3. Implement the task inside `apps/attendance` only.
4. Run the task's `done when` command and the full test suite until both are green. Never weaken, skip or delete tests, and never edit acceptance criteria, to get to green.
5. Review your own diff through 3 lenses: spec conformance, abuse/manipulation (could someone cheat attendance?), and test quality. Fix every high-severity issue.
6. Tick the task `- [x]` in `loop/backlog-attendance.md`.
7. Commit only your own paths: `git add apps/attendance loop/backlog-attendance.md && git commit -m "loop(<id>): <title>"`. Retry if git reports an `index.lock`, because a meet loop may commit `apps/meet` at the same time. The repo has no commits yet and other scaffold files are uncommitted; leave those alone.
8. Run `loop/log-event.sh feature attendance <id> merged "<short sha> <one-line summary>"` (also log `test_pass`/`test_fail`/`review_fail`/`fixed` as they happen).

Start at T01 (scaffold Next.js + Vitest + Playwright + smoke test), then keep going in order. Stop when the backlog is done or every remaining task is blocked.

Never ask the human in chat. When a task needs a human decision or secret, append an entry to `loop/decisions.md` (use the format in that file), log `decision_needed`, mark the task `- [!]`, and move to the next unblocked task.

Do NOT edit: `specs/*`, `loop/backlog-meet.md`, `loop/ventures.md`, `apps/meet`, `CLAUDE.md`, `LOOPS.md`, `KICKOFF.md`, `README.md`, `.claude/*`. If `CLAUDE.md` appears while you work (another workflow is finishing the harness), read it and follow it from the next task on.

Fixed decisions (already made by the loop holder):
- Deploy target: loop-runner staging, tailnet only, via Tailscale Serve at `https://loop-runner.<tailnet>.ts.net/attendance`, proxied to the app on `127.0.0.1:3100`. The Serve mount exists in plan, but Serve must first be enabled in the tailnet admin, so treat the deploy task as blocked until `tailscale serve status` shows `/attendance`.
- Next.js `basePath` comes from env (`BASE_PATH`): empty in dev, `/attendance` on staging. Keep it empty in dev because the registered Google redirect URI is `http://localhost:3000/api/auth/callback/google`. Staging also needs `https://loop-runner.<tailnet>.ts.net/attendance/api/auth/callback/google` registered in Google Console: log that as a decision when you reach the deploy task.
- WebAuthn RP ID and origin come from env too: `localhost`/`http://localhost:3000` in dev; `loop-runner.<tailnet>.ts.net`/`https://loop-runner.<tailnet>.ts.net` on staging.
- Client IP: the app binds 127.0.0.1, so only the local proxy can reach it. Read the client IP from ONE configurable trusted header (`TRUSTED_IP_HEADER`). On the tailnet, clients appear with 100.x tailnet IPs, so the allowlist must accept any CIDR, including tailnet ranges, for the demo.

Secrets are already stored OUTSIDE the repo and verified live. After T01 creates `apps/attendance`, run `loop/secrets.sh link attendance`. It symlinks a gitignored `apps/attendance/.env.local` holding `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_SECRET`. Make sure `.env*` is in `.gitignore` before your first commit. Never print secret values; `loop/secrets.sh names attendance` shows them masked. Automated tests must use the test-only sign-in provider and the CDP virtual WebAuthn authenticator from the spec, so no real Google account or phone is needed.

Done when every task up to the first human-blocked one is ticked, all tests are green, each task has its own `loop(<id>)` commit, and `loop/observe.sh summary` shows the progress.
````

## Background

Sent with the prompt as context for the new session.

````text
This repo backs a live teaching session on AI agent loops, run by Ahmed (the loop holder) while Mahran presents. In `~/loop-lab` (on loop-runner), agent loops build two apps with minimal human involvement. Attendance is the closed loop: spec → tests as the oracle. Meet is a LiveKit venture loop. The human only answers entries in `loop/decisions.md` and provides secrets, which are done for Google and LiveKit. Every step is observable through `loop/ledger.jsonl`, `loop/observe.sh` and git history, and the audience watches it live, so log events faithfully and keep commits small. A separate scaffold workflow is still finishing the harness files (`CLAUDE.md`, `LOOPS.md`, `KICKOFF.md`, `.claude/workflows/*`), and a meet build loop may run in parallel in `apps/meet`. Stay inside `apps/attendance` plus the backlog, ledger and decisions files.
````
