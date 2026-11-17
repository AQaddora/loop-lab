# loop-lab

A real system, built live by AI agent loops during the workshop
**[The Loop in Practice: From Task to Trusted Results](https://mahranbayed.com/ai-talent-lab/?section=the-loop-workshop)**
(AI Talent Lab). The workshop is based on *[The Loop Explained](https://aqaddoura.com/library/files/The-Loop-Explained-AR-v0.2.pdf)* by Ahmed Qaddoura (Arabic, v0.2).

- **The app:** `attendance`, an on-site check-in system that resists cheating. Production origin: **https://attendance.apps.taqat.academy**,
  served by the production loop once its first deploy (T16) lands.
- **The method:** agents build, review and test it, and the production loop is being built to deploy it. The human is the **loop holder**: he designs the loop and answers decisions. He is *on* the loop, not *in* it.
- **This repo is for trainees and their agents.** Fork it, take one small task, and open a PR that carries its evidence ([CONTRIBUTING.md](CONTRIBUTING.md)).

> "Your AI says 'done.' Learn how to prove it." (the workshop's hook)

## What happened on 2026-11-17

All of this is in `git log`, `loop/ledger.jsonl` and `loop/decisions.md`.

| When (UTC) | What | Where to check |
|---|---|---|
| 11:54 → 13:32 | The feature loop merged 19 of the 20 attendance tasks unattended, one commit per task | `git log --oneline`, D-023 |
| on the way | 4 `test_fail` and 3 `review_fail` events, each followed by a `fixed` event in the same task | `loop/ledger.jsonl` |
| 13:32 | T15 converged the whole oracle: 74 E2E tests, 96 unit tests, AC coverage for every AC except AC-39, and the prod guard | ledger, task T15 |
| during the build | The loop wrote its questions to `loop/decisions.md` and kept working, instead of asking in chat (`CLAUDE.md` rule 3) | D-001 … D-022 |
| 12:25 | The holder stopped the `meet` venture loop before any build started ("Stop the meet, no need for open loop") | ledger, `venture` loop |
| 21:15 | The holder chose how trainee PRs will reach `main`: the CI oracle green and his review. Branch protection enforces it once task P05 is done | D-024 |
| 21:17 | T16, the deploy, was the only task left. The holder **steered**: the build loop drifts into a **production loop**. On 2026-11-17 it was still being built (T16, P01 … P06 open) | D-023, `specs/prod-loop.md` |

Every prompt the holder typed is in [docs/history/](docs/history/). The story is in [docs/blog/](docs/blog/).
The guides for trainees are in [docs/guide/](docs/guide/).

## The 60-second picture

```
+------------------------------------------------------------------------------+
| PRODUCTION LOOP (decided in D-023; being built: T16, then P01..P06)          |
|   oracle: production itself          spec: specs/prod-loop.md                |
|   plan: green main -> build -> deploy -> remote smoke -> observe O1..O7      |
|   red smoke -> roll back, pause, open a decision                             |
+------------------------------------------------------------------------------+
        ^  the holder steered the converged build loop into this one
+------------------------------------------------------------------------------+
| VENTURE LOOP (days)                     oracle: the loop holder's judgment   |
|  ideate.js proposes features -> the holder approves them in decisions.md     |
|  +------------------------------------------------------------------------+  |
|  | FEATURE LOOP (hours)         oracle: done-when + full gate + 3 reviews |  |
|  |  build-next.js: pick -> build -> review x3 -> fix <=2 -> commit        |  |
|  |  +------------------------------------------------------------------+  |  |
|  |  | INNER LOOP (minutes)                           oracle: npm test  |  |  |
|  |  |  edit -> run tests -> try to stop -> Stop hook: red? keep going  |  |  |
|  |  +------------------------------------------------------------------+  |  |
|  +------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------+
  memory: git + loop/ledger.jsonl + backlog ticks   escalate: loop/decisions.md
```

| Loop | Engine | One iteration | Stops when |
|---|---|---|---|
| Inner | one Claude Code session + the Stop hook `loop/hooks/stop-gate.sh` | edit → test → try to stop | tests green, or 3 forced retries, then `blocked` |
| Feature | the `build-next` workflow, repeated with `/loop` or `/schedule` | one backlog task, 3 reviewers, at most 2 fix rounds, one commit | no unblocked task, a task blocks, or `max` (capped at 20) |
| Venture | the `ideate` workflow (built for `meet`; the holder stopped it) | propose → judge → queue the top 3 as decisions | 3 venture decisions waiting |
| Production (decided, being built) | two cron jobs and an agent session on `loop-runner`, once P02 and P03 exist (`loop/backlog-prod.md`) | ship one green `main` commit, then check it | a red smoke rolls back and pauses; only the holder resumes |

The production loop is the decided design (D-023, `specs/prod-loop.md`), not yet a running loop. On 2026-11-17 its
first deploy (T16) and its own tasks (P01 … P06 in `loop/backlog-prod.md`) were open, and the ledger had no
`deployed` event. To see what is live now, run `loop/observe.sh summary` and look for `deployed` events in `loop/ledger.jsonl`.
[LOOPS.md](LOOPS.md) explains each loop, its failure modes and the autonomy dial.

## The five stations, in this repo

The workshop's loop has five stations: **Task → Agent → Review → Deploy → Lesson**.
"Each station leaves something the next person can inspect."

| Station | The lecture | In this repo |
|---|---|---|
| **Task** | a clear brief | the ACs in `specs/attendance.md` §8, and one line in `loop/backlog-attendance.md` with its `done when` command. For trainees: an issue labelled `loop-task` |
| **Agent** | a bounded change | one Claude Code session, or one iteration of `.claude/workflows/build-next.js`: one task, one commit (`CLAUDE.md` rule 1) |
| **Review** | evidence and judgment | the oracle (done-when, `npm run check`, AC coverage, E2E, prod guard) plus three skeptic reviewers in build-next (spec, security, test quality). For a PR: `.github/workflows/oracle.yml`, then the holder (`.github/CODEOWNERS`) |
| **Deploy** | verify the running version | the production loop (decided in D-023, being built): green `main` → https://attendance.apps.taqat.academy → remote smoke → observer (`specs/prod-loop.md` §4) |
| **Lesson** | improve the next task | a rule with its reason, written where the next agent reads it (`CLAUDE.md`, `apps/attendance/AGENTS.md`), plus a test that would have caught the problem (`specs/prod-loop.md` §4.4) |

The three roles from the workshop:

| Role | Here |
|---|---|
| Requester | the loop holder (specs, decisions), or you when you write a brief |
| Implementer | the agent: the build-next builder, or your Claude Code session |
| Reviewer | the oracle, the three reviewer lenses, the CI `oracle` check, and finally the holder |

## The six parts of an unattended loop

| Part | Question | File |
|---|---|---|
| **Goal** | what is "done"? | `specs/attendance.md` (AC-01 … AC-43), `loop/backlog-attendance.md`, `specs/prod-loop.md` §1 and PR-01 … PR-10 |
| **Act** | what may one iteration do? | exactly one backlog task (`CLAUDE.md` rule 1), the phases in `.claude/workflows/build-next.js` |
| **Check** | who says it worked, automatically? | each task's `done when`, `npm --prefix apps/attendance run check`, `apps/attendance/scripts/check-ac-coverage.sh`, `apps/attendance/scripts/check-prod-no-test-mode.sh`, `loop/hooks/stop-gate.sh`, `loop/checks/secret-scan.sh`, `.github/workflows/oracle.yml` |
| **Stop** | when does it stop? | `MAX_RETRIES=3` in `loop/hooks/stop-gate.sh`; `FIX_ROUNDS = 2` and `HARD_CAP = 20` in `build-next.js`; "no unblocked task"; `loop/.deploy-paused` in the production loop's design (`specs/prod-loop.md` §4.1) |
| **Memory** | how does run N+1 know about run N? | git (one commit per task), `loop/ledger.jsonl`, backlog ticks, `loop/hooks/session-start.sh` |
| **Escalate** | what happens when it cannot decide? | `loop/decisions.md` + a `decision_needed` event (+ a Telegram ping to the holder, D-002), a `- [!]` task, an attempt parked on `loop/blocked-<id>` |

## Repo map

```
README.md                      this file
CONTRIBUTING.md                how a trainee contributes with an agent
SECURITY.md                    how to report an anti-cheat bypass
CLAUDE.md                      the rules every agent follows here (read it first)
LOOPS.md                       theory -> practice: the loops, the six parts, failure modes, the autonomy dial
KICKOFF.md                     the copy-paste runbook prepared for the live session (docs/history/ has what was typed)
specs/attendance.md            what to build: flows, anti-manipulation design, threats TH-01..TH-25, AC-01..AC-43
specs/prod-loop.md             the production loop: goal, deploy, observer O1..O7, PR-01..PR-10
specs/meet.md                  the venture-loop demo app (stopped by the holder; apps/meet/ was never built)
loop/backlog-attendance.md     T01..T20, each with a "done when" command
loop/backlog-prod.md           P01..P06, the production loop's tasks
loop/backlog-meet.md           M01..M05 (not started: the holder stopped meet)
loop/ventures.md               the meet feature pool
loop/decisions.md              the holder's inbox: every question the loop could not decide
loop/ledger.jsonl              append-only event log, written only by loop/log-event.sh
loop/log-event.sh              append one event (+ optional ping to the holder)
loop/observe.sh                live view | summary | brief | next <app>
loop/secrets.sh                a secret store outside the repo (~/.config/loop-lab/secrets/<app>.env)
loop/checks/                   probes and checks: Google client, LiveKit, secret-scan.sh (the publication guard, PR-07)
loop/hooks/                    session-start.sh (memory) and stop-gate.sh (inner loop)
loop/briefs/                   briefs given to dispatched loop sessions
.claude/settings.json          wires the two hooks
.claude/workflows/             build-next.js (feature loop), ideate.js (venture loop)
.github/                       the CI oracle, PR and issue templates, CODEOWNERS
apps/attendance/               the app, written by the loop from T01 on
docs/history/                  every prompt the holder typed
docs/blog/                     the story of the session
docs/guide/                    guides and exercises for trainees
```

Server names in this repo are aliases. `loop-runner` is the box the loops run on. `apps-host` is the production host.
Only the production loop's deploy steps need them. Everything else runs on your own machine.

## Run it on your fork

Requirements: Node 22 and npm, git, bash, jq (the hooks and `observe.sh` use it), and
[Claude Code](https://claude.com/claude-code) with workflows and `/loop` for running the loops.

```bash
git clone https://github.com/<your-account>/loop-lab && cd loop-lab
npm --prefix apps/attendance ci
(cd apps/attendance && npx playwright install chromium)

# the oracle, the same commands CI runs, in its order
bash loop/checks/secret-scan.sh                           # no secret, private name or personal email (PR-07)
npm --prefix apps/attendance run check                    # lint + typecheck + unit
bash apps/attendance/scripts/check-ac-coverage.sh         # every AC has a titled test, nothing skipped
npm --prefix apps/attendance run e2e                      # Playwright; starts its own test server on :3100
bash apps/attendance/scripts/check-prod-no-test-mode.sh   # a production build has no test bypass
```

The oracle needs **no secrets**. `apps/attendance/.env.e2e` holds dummy, test-only values, and the prod guard sets its own.
Running the app with real Google sign-in needs your own OAuth client in `apps/attendance/.env.local` (names in `.env.example`).
See [docs/guide/attendance-system.md](docs/guide/attendance-system.md).

Run a loop:

```bash
echo attendance > loop/.gate   # turns on the inner loop for attendance
claude                         # the SessionStart hook prints where the loop is
```

Then, in that session: `Run the build-next workflow with args {app:'attendance', max:1, deploy:false}`.

On a fork, the only open attendance task is T16, a deploy to the holder's servers, and the `loop/backlog-prod.md` tasks need those servers too.
To watch the feature loop work, add a task line of your own to your fork's backlog, in the same format as the others, **above T16**:
the picker takes the first open task in file order whose deps are done. Do not run it for `meet`: the holder stopped that loop.
Keep that backlog line, and the ledger lines the loop writes, out of any PR you send upstream.
Upstream, new tasks come in through issues and decision entries ([CONTRIBUTING.md](CONTRIBUTING.md)).
[KICKOFF.md](KICKOFF.md) is the runbook prepared for the live session, including a 60-second inner-loop demo.
Its repeat commands were prepared, not run. The prompts actually typed are in [docs/history/](docs/history/).

Runtime state is gitignored and created on demand: `loop/.gate`, `loop/.gate-retries`, `loop/.gate-green`, `loop/.gate-gaveup`,
`apps/<app>/.env.local`, and `~/.config/loop-lab/` outside the repo.

## Observe the loop

| Question | Command |
|---|---|
| What is happening right now? | `loop/observe.sh` (live, colored event stream) |
| How far along is it? What is open? | `loop/observe.sh summary` |
| What landed? | `git log --oneline --decorate -20` · `git branch --list 'loop/blocked-*'` |
| What does it need from the holder? | `loop/decisions.md` (entries with `status: OPEN`) |
| What does a new session see? | `loop/hooks/session-start.sh </dev/null` (a preview; it logs nothing) |
| Where did it struggle? | `jq -s 'map(select(.event=="test_fail" or .event=="review_fail")) \| group_by(.task) \| map({task: .[0].task, n: length})' loop/ledger.jsonl` |

## Read next

- [CONTRIBUTING.md](CONTRIBUTING.md): fork, brief, stopping point, evidence, PR
- [docs/guide/the-loop-in-this-repo.md](docs/guide/the-loop-in-this-repo.md): the workshop's ideas, applied to these files
- [docs/guide/attendance-system.md](docs/guide/attendance-system.md): what the app does, how it resists cheating, its honest limits
- [docs/guide/exercises.md](docs/guide/exercises.md): small tasks to start your own loop
- [SECURITY.md](SECURITY.md): found a way to cheat the system? Report it privately
