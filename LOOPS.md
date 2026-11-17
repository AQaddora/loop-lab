# LOOPS: the loop, from theory to practice

> **A loop** is an agent that acts toward a goal, checks its own work with an automatic **oracle**, remembers what happened,
> and repeats until a **stop condition**. It escalates only what it cannot decide.
> The human is **on** the loop (designs it, holds the decisions), not **in** it (typing, approving every step).

## 1. Three nested loops

```
+------------------------------------------------------------------------------+
| VENTURE LOOP (days)                     oracle: the loop holder's judgment   |
|  ideate.js: 4 lenses propose -> 3 judges score -> top 3 -> loop/decisions.md |
|      ^                                                    |                  |
|      | the next run sees the new state                    v holder: APPROVED |
|  +------------------------------------------------------------------------+  |
|  | FEATURE LOOP (hours)         oracle: done-when + full gate + 3 reviews |  |
|  |  build-next.js: pick -> build -> review x3 -> fix <=2 -> commit        |  |
|  |                 -> ledger -> deploy (once a deploy target is decided)  |  |
|  |      ^                                                                 |  |
|  |      | next task                                                       |  |
|  |  +------------------------------------------------------------------+  |  |
|  |  | INNER LOOP (minutes)                           oracle: npm test  |  |  |
|  |  |  edit -> run tests -> try to stop -> Stop hook: red? keep going  |  |  |
|  |  |                                     (max 3 retries)  green: stop |  |  |
|  |  +------------------------------------------------------------------+  |  |
|  +------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------+
  memory: git + loop/ledger.jsonl + backlog ticks  escalation: loop/decisions.md
```

| Loop | Cadence | Engine (Claude Code primitive) | One iteration | Oracle | Stops when |
|---|---|---|---|---|---|
| **Inner** | minutes | one agent session + the `Stop` hook `loop/hooks/stop-gate.sh` (it stands aside while a build-next iteration owns the tree: there the builder iterates to green itself) | edit → test → try to stop | `npm --prefix apps/<app> test` | green; or 3 forced retries, then `blocked` (no new forcing until the code changes) |
| **Feature** | hours | `build-next` workflow, repeated by `/loop` (self-paced or `20m`) or `/schedule` | one backlog task: pick → build → 3 reviewers → fix ≤2 → commit → ledger | done-when + full gate + 3 adversarial reviewers | no unblocked task; a task blocks; `max` reached (≤20) |
| **Venture** | days | `ideate` workflow on `/loop 30m` | 4 lenses propose → 3 judges score → top 3 queued | **the loop holder's judgment** in `loop/decisions.md` | WIP cap: 3 OPEN venture decisions |
| Deploy | per merge | the Deploy phase of build-next | ship the merged sha → run the deploy oracle | remote smoke / two-party e2e on staging | pass → `deployed`; fail → roll back + decision |

Two kinds of loop on purpose:

| | **attendance**: closed loop | **meet**: open (venture) loop |
|---|---|---|
| Goal | fixed: spec ACs AC-01…AC-43 | grows: a tiny v0 + approved ventures |
| Converges? | yes: every task `[x]`, AC coverage script green | never; the loop holder steers |
| Oracle | tests written from the spec (virtual authenticator, fake clock, IP header in test mode) | v0 tests + one new e2e per venture + `verify` |
| Human | answers OD-1…OD-10 (D-003, D-004, D-008…D-013, D-016, D-017), provides the OAuth client | approves, parks or rejects ventures (fewer at L1/L2) |

## 2. The 6 properties every unattended loop needs

| Property | Question | In this repo | Without it |
|---|---|---|---|
| **Goal** | what is "done"? | `specs/<app>.md` ACs + `loop/backlog-<app>.md` order | it builds whatever it likes |
| **Action** | what may one iteration do? | exactly one backlog task (CLAUDE.md rule 1); the build-next phases | sprawling, unreviewable diffs |
| **Oracle** | who says it worked, automatically? | done-when commands, the full gate, Stop hook, 3 review lenses, deploy smoke | confident garbage |
| **Stop condition** | when does it stop? | Stop gate cap 3 · fix rounds 2 · `max` ≤20 · "no unblocked task" · ideate WIP cap 3 | it burns money forever |
| **Memory** | how does run N+1 know about run N? | git (one commit per task) · `loop/ledger.jsonl` · backlog ticks · SessionStart hook re-injects state | it redoes or undoes work |
| **Escalation** | what happens when it cannot decide? | `loop/decisions.md` + `decision_needed` (+ Telegram ping) · task `[!]` · attempt parked on `loop/blocked-<id>` | it guesses, or asks in chat and waits forever |

## 3. Human touchpoints: the complete list

| When | The loop holder… | Where | Why a machine can't |
|---|---|---|---|
| before loop 0 | approves the specs (the ACs **are** the oracle) | `specs/*.md` | defines what "correct" means |
| once | provides secrets: Google OAuth client, LiveKit Cloud keys, deploy credential, optional Telegram bot | `loop/secrets.sh add <app>` · `~/.config/loop-lab/loop.env` | identity, billing, trust |
| when pinged | answers decisions (OD-n, MEET-n, blockers) | `loop/decisions.md` | judgment, risk, money |
| when pinged | approves / parks / rejects ventures | `loop/decisions.md` | product direction |
| rarely | turns the dial: autonomy L0→L2 (MEET-4), `max`, cadence | decisions.md, workflow args | trust is earned from the ledger |
| before prod | promotes beyond staging | n/a | accountability |

**Everything else is the loop:** picking work, writing code and tests, reviewing, fixing, committing, deploying staging, logging,
proposing features, scoring them, converting approvals into tasks.

> The product mirrors the method. attendance has its own human on the loop: the admin approves each new passkey. The system does
> everything else, and a human approves the one fact software cannot verify ("this phone belongs to this employee"). `decisions.md` plays the same role for the build.

## 4. Failure modes and guards

| Failure | How it shows up (ledger / git) | Guard in this repo |
|---|---|---|
| **Runaway loop** | the same task cycling `test_fail`, cost climbing | Stop gate cap 3 (`loop/.gate-retries`), then silent on that unchanged red tree (`loop/.gate-gaveup`) · fix rounds ≤2 · `max` capped at 20 · a blocked task ends the run · `/loop` stop condition · ideate WIP cap |
| **Two drivers, one tree** | a session "fixing" code while a workflow's builder edits it; two build-next runs picking the same task | the Stop gate stands aside while build-next is mid-task · one feature loop per checkout · fixed-cadence `/loop` prompts skip a tick while the last run is still going |
| **Reward hacking** | tests deleted or `.skip`ped, `expect(true)`, ACs or done-when edited, a test bypass live in prod | test-quality lens (re-runs the oracle, greps skips, diffs `specs/` + backlog) · CLAUDE.md rules 4-5 · `apps/attendance/scripts/check-ac-coverage.sh` (T17 creates it) · `apps/attendance/scripts/check-prod-no-test-mode.sh` (T06) |
| **False green** | builder says green, it is not | the test lens runs the commands itself, and again after every fix round |
| **Spec drift** | features nobody asked for, or code ≠ spec | spec-conformance lens (scope creep = issue) · only the holder edits specs · changes go through a decision |
| **Context loss** | a new session redoes or contradicts work | SessionStart hook injects backlog, decisions and the last events · one commit per task |
| **Decision starvation** | `[!]` tasks pile up, the loop idles | Telegram ping on `decision_needed` · the loop moves to the next unblocked task · the WIP cap stops ideate flooding the inbox |
| **Flaky oracle** | pass/fail alternating on the same sha | meet done-whens use `--repeat-each=3` · attendance never sleeps in real time (`setClock`) |
| **Secret leak** | a key in a diff or the ledger | `.gitignore` · recorder safety check · `check:no-secret` (meet) · secrets kept outside the repo via `loop/secrets.sh` |
| **Broken main** | the next task builds on red code | blocked attempts are parked on `loop/blocked-<id>` · the Stop gate |
| **Cost** | tokens per task | per task 6-14 agents (1 pick + 1 build + 3 reviews + ≤2 × (1 fix + ≤3 re-reviews) + 1 record; meet adds 1 venture converter, a redeploy adds 1) · only failing lenses (+ the test lens) re-review · ideate ≤9 agents per run · `max`, cadence, `effort: low` on the ideate scan |

## 5. The autonomy dial (how little human?)

| Level | The human does | The loop does alone |
|---|---|---|
| **L0** (live demo) | approves every venture, answers every decision | everything else |
| **L1** | approves only M/L ventures, or ventures that need a new secret | auto-approves gated ventures: size S, `local` oracle, ≥16/20 |
| **L2** | reads the ledger weekly; can veto after the fact (REJECTED reverts) | auto-approves gated ventures ≥14/20 |

You move up the dial with evidence from `loop/ledger.jsonl`, e.g. 20 merges with no security `review_fail` that the tests missed.

## 6. Slide → repo map (for the presenter)

| Slide idea | Show this | Command |
|---|---|---|
| "a loop" | the diagram above | n/a |
| oracle | a `done when` line, then `loop/hooks/stop-gate.sh` | `grep -m3 'done when' loop/backlog-attendance.md` |
| stop condition | retry cap, `FIX_ROUNDS`, `HARD_CAP` | `grep -n 'MAX_RETRIES=\|FIX_ROUNDS =\|HARD_CAP =' loop/hooks/stop-gate.sh .claude/workflows/build-next.js` |
| memory | ledger + git + the SessionStart context | `loop/observe.sh summary` · `git log --oneline` · `loop/hooks/session-start.sh </dev/null` |
| escalation | the holder's inbox | `loop/decisions.md` |
| adversarial review | 3 lenses + fix rounds | `/workflows` while build-next runs |
| human on the loop | answer one decision live, watch the next run pick it up | edit `loop/decisions.md` |
| open-ended growth | ventures proposed, judged, queued | `/loop 30m run the ideate workflow for meet` |

Run it: **KICKOFF.md**.
