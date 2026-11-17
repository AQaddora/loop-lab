# Prompts written on the holder's behalf

The holder (the requester, in the lecture's words) interacted 23 times all day, and 16 of those were typed messages.
The long prompts the agents ran on were written by the orchestrator, from those messages. This file lists every prompt the orchestrator
wrote and dispatched: what it was, when and where it ran, and what came of it. Times are UTC, 2026-11-17.

Server names and paths in the copies are replaced by public aliases (see [README](README.md#publication-rules)).
Nothing else in the copies is changed.

| # | Prompt | Dispatched | Ran where | Came of it |
|---|---|---|---|---|
| 1 | [Scaffold workflow](#1-scaffold-workflow-loop-lab-scaffold) (7 agent prompts) | 11:21:06 | background workflow in the orchestrator session | specs, backlogs and loop harness; 18 decisions queued |
| 2 | [Attendance build-loop brief](#2-attendance-build-loop-brief) | 11:48:07 | its own session, "Attendance build loop (T01 onward)" | 19 of 20 tasks merged by 13:32 |
| 3 | [Meet loop brief](#3-meet-loop-brief-proposed-never-started) | 11:50:35 | a session card; never started | withdrawn at 12:25 |
| 4 | [Repeat commands](#4-repeat-commands-prepared-not-run) | written into KICKOFF.md and the showcase page | nowhere | not run |
| 5 | [Lecture reader](#5-lecture-reader-subagent) | 21:00:22 | a subagent of the orchestrator | could not read the slides |
| 6 | [Go-public workflow](#6-go-public-workflow-loop-lab-go-public) | 21:22:32, again at 21:26 | background workflows in the orchestrator session | running at the snapshot; this folder is one of its outputs |
| 7 | [Production-loop brief](#7-production-loop-brief) | written 21:24:27 | not dispatched yet | waiting for the first deploy |
| 8 | [Note to the fleet's control session](#8-note-to-the-fleets-control-session) | 21:23:44 | the fleet's control session | sent |

## 1. Scaffold workflow (`loop-lab-scaffold`)

- **When:** launched at 11:21:06 and finished at 12:19:20 (3,494 s, about 58 min). Run `wf_6316037a-16a`.
- **Where:** a background workflow in the orchestrator session on loop-runner. It started about 4 minutes after the holder's first message (H01).
- **Copy:** [prompts/scaffold-workflow.js](prompts/scaffold-workflow.js). Only `ROOT` and `SCRATCH` (two paths) and one path in the description differ from the original.

The script is a fixed plan that starts agents. It holds seven prompts, built from one shared `CONTEXT` block
(the purpose, the fixed file contract, the backlog line format, the ledger event format and the decision format):

| Agent | Prompt | Asked for |
|---|---|---|
| `scaffold:attendance` | `ATTENDANCE` | `specs/attendance.md` (roles and flows, anti-manipulation design, threat table, data model, routes, stack, the automated test oracle, acceptance criteria AC-01…AC-NN, open decisions) and a backlog of about 14–16 tasks, each with a real `done when` command |
| `scaffold:meet` | `MEET` | `specs/meet.md` (a tiny LiveKit v0, a test oracle against a local LiveKit dev server, the venture loop), `loop/backlog-meet.md` (M01–M05) and `loop/ventures.md` (about 15 ideas) |
| `scaffold:harness` | `HARNESS` | README, CLAUDE.md, LOOPS.md, KICKOFF.md, the decisions file, the empty ledger, `log-event.sh`, `observe.sh`, the two hooks, `.claude/settings.json` and the workflows `build-next.js` and `ideate.js` |
| `review:attendance` | `REVIEWS.attendance` | act as a dishonest employee, a dishonest admin, and an engineer who must build each task in one iteration with no human help; fix the gaps in place |
| `review:meet` | `REVIEWS.meet` | verify every LiveKit package, class and API is real and current; check the oracle needs no humans and no cloud keys |
| `review:harness` | `REVIEWS.harness` | assume the harness runs unattended for hours; test the hooks, workflows and scripts and fix them in place |
| `integrate` | inline | append the open decisions to `loop/decisions.md`, check that every referenced path exists, run `observe.sh summary` and the session-start hook |

Each builder fed its own reviewer as soon as it finished (a pipeline, not a barrier), and the integrator ran last.

**What came of it** (from the workflow's run record):

| Agent | Ran (UTC) | Tool calls | Result |
|---|---|---|---|
| `scaffold:meet` | 11:21:06–11:31:27 | 44 | meet spec, backlog, venture pool |
| `scaffold:attendance` | 11:21:06–11:34:05 | 6 | spec with AC-01…AC-39 and a 16-task backlog |
| `scaffold:harness` | 11:31:29–11:53:07 | 43 | the loop harness |
| `review:meet` | 11:34:05–11:49:52 | 88 | 30 fixes, 8 items left open |
| `review:harness` | 11:53:07–12:05:45 | 65 | 14 fixes, 8 items left open |
| `review:attendance` | 11:49:52–12:11:10 | 31 | 25 fixes, 6 items left open |
| `integrate` | 12:11:10–12:19:20 | 46 | decisions D-002…D-019 queued (ledger, 12:18:10: "18 setup decisions queued") |

The attendance reviewer worked while the build loop was already merging tasks. It kept the lines of T01–T06 as they
were and added T17–T20, so the spec grew from 39 to 43 acceptance criteria and the backlog from 16 to 20 tasks.
T18 then brought the code already merged up to the revised spec (header of `loop/backlog-attendance.md`).
Some of the reviewer's fixes, in its own words from the run record:

- "Race: the punch state check ran outside the write transaction, so two parallel punches could both check in."
- "Dishonest admin: 0.0.0.0/0, ranges shorter than /16 (v4) or /32 (v6), and private/loopback/CGNAT/ULA ranges are rejected"
- "Approval by name was socially engineerable. Approve now needs a 6-char confirm code"
- "Done-when cheat: grepping several AC ids passed when only one AC had a test" (this became T17, the AC coverage guard)
- "Overclaim: the chain 'detects deleted rows'." (the spec now says tamper-evident, with an anchored head hash)

## 2. Attendance build-loop brief

- **When:** sent at 11:48:07, 19 seconds after the holder chose "New session" on the card (H10).
- **Where:** a new session, "Attendance build loop (T01 onward)", in `~/loop-lab` on loop-runner.
- **Copy:** [prompts/attendance-build-loop-brief.md](prompts/attendance-build-loop-brief.md) (prompt and background).

The brief is the loop's contract in eight steps: pick the first unblocked task, log `start`, build only in
`apps/attendance`, run the `done when` command and the full suite until both are green, review the diff through three
lenses (spec conformance, abuse, test quality), tick the task, commit `loop(<id>)`, log `merged`. It says "Never ask the
human in chat": a question goes to `loop/decisions.md`, the task is marked `- [!]`, and the loop moves on. It carried the
holder's fixed decisions from H07 and H08 (the tailnet staging target) and the rule that secrets stay outside the repo.

**What came of it** (`loop/ledger.jsonl` and `git log`):

- 19 of 20 tasks merged between 11:54:11 (T01, `1cca1e4`) and 13:32:27 (T15, `5be44a6`), one `loop(Txx)` commit each.
- 7 tasks hit a self-review or test failure first and were fixed before they merged: T05, T06, T07 (`review_fail`),
  and T09, T12, T13, T18 (`test_fail`).
- It opened D-001, D-020, D-021 and D-022 for the holder, and stopped at T16, the deploy, as `blocked` (13:33:07 and 13:34:08).
- Its final run: 96 unit tests, 74 e2e tests, AC coverage and the prod guard, all green.
- The three lenses ran as a self-review inside this one session (the ledger calls them "self-review"). The `build-next`
  workflow, which starts three separate reviewer agents, was written by the scaffold but was not used today.
- After the holder's later messages to this session (H19 to H22), it added commit `115f117` for the tailnet mirror (21:33:04).

## 3. Meet loop brief (proposed, never started)

- **When:** written at 11:50:35 and shown to the holder as a session card, "Meet build + venture loop (M01 onward)".
- **Where:** nowhere. A card runs nothing until the holder starts it.
- **Copy:** [prompts/meet-loop-brief.md](prompts/meet-loop-brief.md).

It had the same eight-step contract for `apps/meet`, an oracle of two headless browsers in a local LiveKit dev server,
and a venture step: propose features through four lenses, score them, and queue the top 3 as OPEN decisions for the holder.

**What came of it:** at 12:25:02 the holder wrote "Stop the meet, no need for open loop" (H12). The orchestrator withdrew
the card at 12:25:11, parked D-007, D-014, D-015, D-018 and D-019, and logged `venture meet blocked` (12:25:19).
No meet code was written. The spec, backlog, venture pool and LiveKit keys were kept.

## 4. Repeat commands (prepared, not run)

These make a loop turn without a person. The scaffold's harness agent wrote them into `KICKOFF.md`, and the
orchestrator put a short version on the showcase page:

```text
echo attendance > loop/.gate
/loop run the build-next workflow for attendance with max 1; stop the loop when the backlog has no unblocked tasks
/loop 20m run the build-next workflow for attendance with max 1, unless the previous build-next run is still running (then do nothing this tick); stop the loop when the backlog has no unblocked tasks
/loop 30m run the ideate workflow for meet with args {app:'meet', top:3}
/schedule every 2 hours: in the loop-lab repo run the build-next workflow with args {app:'attendance', max:2}, then git push. Do nothing if loop/backlog-attendance.md has no unblocked task.
/schedule nightly: run build-next for attendance and meet, max 3 each
```

**What came of it:** none of them ran today. `loop/.gate` does not exist, the ledger has no `inner` events and no
`build-next` start, and no human message contains them. The build loop ran from the brief in §2 instead.

## 5. Lecture reader (subagent)

- **When:** 21:00:22, after H14 linked the lecture.
- **Prompt:** fetch the workshop section of the lecture page and return a faithful outline in the lecture's own terms.
- **What came of it:** it could not. The page's HTML holds only slide 1 of the deck; the slides are drawn by the
  page's scripts. Between 21:01 and 21:05 the orchestrator read the English slide text of the workshop out of the page's
  script bundle instead. That extract is the source of the lecture vocabulary used in this folder. It is not published here;
  the lecture itself is at https://mahranbayed.com/ai-talent-lab/?section=the-loop-workshop.

## 6. Go-public workflow (`loop-lab-go-public`)

- **When:** launched at 21:22:32, stopped at 21:26:07, then launched again as three runs at 21:26:28, 21:26:32 and 21:26:37,
  each with its own `tracks`: T16 deploy code and ship script; secret scan and trainee docs; history and blog.
- **Where:** background workflows in the orchestrator session on loop-runner.
- **What it asks:** the T16 deploy code, a ship script, a secret scan, this history, trainee docs with a CI oracle, and a
  blog of the lecture, each with an adversarial review, then an independent publication scan. Its rules for every agent
  are the publication rules in the [README](README.md#publication-rules), plus the truth and style rules.
- **What came of it:** this folder is the history track's output. The other outputs and the deploy were not finished at
  the snapshot, so they are not described here.
- The script is not copied here: its rules list the private names it tells agents to replace.

## 7. Production-loop brief

- **When:** written at 21:24:27 to `loop/briefs/prod-loop-session.md`, edited at 21:25:17 (the ping instructions now point to `loop/log-event.sh`).
- **What it is:** the brief for the session that will run `specs/prod-loop.md` (D-023): ship every green `main` to
  attendance.apps.taqat.academy, check production after every release, work through P01–P06, never merge a trainee PR,
  escalate through `loop/decisions.md` with a Telegram ping. Its stopping point: a repair budget of 2 attempts per failing check.
- **What came of it:** not dispatched by the snapshot. The brief says it is dispatched right after the first deploy (T16),
  and the ledger has no `deployed` event yet.

## 8. Note to the fleet's control session

- **When:** 21:23:44 (the send reported "sent" at 21:23:48).
- **What it said:** this session owns the repo AQaddora/loop-lab and the deploy of attendance.apps.taqat.academy, so the
  fleet should not create a second repo or app; and, for the social media video the holder asked for on Telegram, the
  holder's instruction from H15 to use the fleet's existing gateway on his own API, with no new key.
- **What came of it:** not verified here. No video is in this repo.
