# The loop in this repo

The workshop teaches one loop with five stations: **Task → Agent → Review → Deploy → Lesson**.
This page takes each idea from the workshop and shows the file in this repo where it lives.
Quotes come from the workshop page: its slide text, or the trainer's notes that go with each slide (marked
"the trainer's notes"). A quote next to a file name comes from that file. Facts come from `git log`,
`loop/ledger.jsonl` and `loop/decisions.md`; times are UTC on 2026-11-17.

## 1. A report is not a check

The workshop: "The agent reports a change. We still need to check the behavior."

It separates three things: the **report** ("I added the notice"), the **diff** (what changed, and where) and the
**check** (does it work as agreed?). In this repo:

| Thing | Where |
|---|---|
| Report | the builder's summary inside a build-next run. It is a claim, not evidence |
| Diff | one commit per task: `git show 9277aaa` is all of T04 |
| Check | the task's `done when` command and the full gate, run again by a reviewer who did not write the code |

The test-quality reviewer in `.claude/workflows/build-next.js` is "the only reviewer that runs commands". It runs the
done-when and the full gate itself, whatever the builder claimed. `LOOPS.md` §4 calls the failure it guards against
**false green**.

## 2. Three roles

| Role | Workshop | In this repo |
|---|---|---|
| Requester | states the outcome and owns acceptance | the loop holder: writes `specs/`, answers `loop/decisions.md`, merges PRs (D-024) |
| Implementer | makes one bounded change | the build-next builder, or your own Claude Code session |
| Reviewer | judges the evidence | the oracle, three reviewer lenses (spec, security, test quality), the CI `oracle` check, then the holder |

The trainer's notes: "Sensitive decisions stay with their authorized owner." Here the owner is the loop holder. Only he sets `status:` and
`answer:` in a decision, edits a spec, or approves a trainee PR.

## 3. Five stations, one task end to end

"Each station leaves something the next person can inspect." Here is T13 (kiosk pairing and the rotating QR) walked
through the stations, from the ledger:

| Station | What T13 left behind |
|---|---|
| Task | the backlog line in `loop/backlog-attendance.md`: done when `check-ac-coverage.sh AC-32` and the whole E2E suite pass |
| Agent | the builder's change, started at 13:07 (`start` event) |
| Review | the ledger records the whole E2E suite red, with 35 failures. Its reason: `next dev` compiled routes lazily and reloaded open pages mid-test while the box was under load |
| Fix | `apps/attendance/e2e/global-setup.ts` now compiles every route before the first test. Then E2E 66/66 and 96 unit tests green, commit `606b96c` |
| Deploy | none. The build loop's oracle stopped at green tests. That gap is why the holder steered into the production loop (D-023) |
| Lesson | the reason is written next to the fix, where the next session reads it: the warm-up runs "so the oracle measures the app, not the compiler" (`global-setup.ts`) |

## 4. Write a task you can judge

"Agree on the outcome and evidence before the agent starts." The workshop's brief has four boxes.
Every backlog line in this repo fills them:

| Box | In a backlog line | T04 as an example |
|---|---|---|
| Outcome | the title and notes | client IP + CIDR allowlist + QR token primitives, for AC-02 … AC-05 |
| Check | `done when` | `npm --prefix apps/attendance test -- tests/unit/ip.test.ts tests/unit/qr.test.ts` |
| Boundary | deps, the notes, and `CLAUDE.md` rule 1 (one task, no drive-by refactors) | "Pure functions, clock injected" |
| Evidence | the ledger events and the commit | `test_pass` "done-when ip+qr 16/16 green (AC-02..05); check green (33 unit)", commit `9277aaa` |

The trainer's notes add: "Keep tests and reference images outside the agent's editable scope." Here, only the holder edits `specs/`. The test
reviewer diffs `specs/` and the backlog against `HEAD`, and `apps/attendance/scripts/check-ac-coverage.sh` fails on any
`.skip(`, `.only(`, `.fixme(`, `test.todo`, `xit(` or `passWithNoTests`. A `done when` must fail before the work and
pass after it (backlog header).

## 5. Read the evidence before the verdict

"A result is meaningful only within the checks actually performed." Four statuses, with a real case for each:

| Status | Workshop meaning | A case from this repo |
|---|---|---|
| **PASS** | criteria and evidence complete | T15 at 13:32: no-arg AC coverage PASS, 96 unit tests, E2E 74/74, prod guard PASS |
| **FAIL** | a criterion or required evidence is missing | T07: a self-review found the last-owner guard unreachable behind the self-action rule, so AC-43's `invalid_state` for the last owner could never be returned. Fixed by reordering the rules |
| **ERROR** | the check could not run | D-022: a staging server on port 3100 would make `npm run e2e` fail with "port already used". That says nothing about the code. The trainer's notes: "A browser that cannot start is ERROR" |
| **SKIP** | does not apply; state why | `check-ac-coverage.sh` with no arguments skips AC-39 and says why in its header: AC-39 needs a deployed URL, so the deploy task checks it |

T13's 35 red tests (section 3) are worth a second look. The ledger logged them as `test_fail`, but the cause was the
test server more than the kiosk code. That is arguably closer to ERROR than FAIL. Classify by cause, not by colour.

The trainer's notes: "PASS covers the agreed checks, not every possible defect." The oracle uses two stand-ins (spec §7.5): `test-login`
replaces Google, and a virtual authenticator replaces the phone. A green suite proves nothing about a real phone.

## 6. Set a stopping point

The workshop's checklist, and where each item lives:

| Workshop | In this repo |
|---|---|
| Small scope and enforced permissions | one task per iteration; the CI oracle runs on `pull_request` with a read-only token (`permissions: contents: read`); `.github/CODEOWNERS`. Not enforced: the build-next reviewers are read-only only because their prompt says so (`reviewPrompt` in `build-next.js`), not by a tool permission |
| A known repair budget | `FIX_ROUNDS = 2` in `build-next.js` (the workshop also allows two repairs); `MAX_RETRIES=3` in `loop/hooks/stop-gate.sh`; `HARD_CAP = 20` iterations per run |
| A diagnosis when blocked | a stuck attempt is parked on `loop/blocked-<id>`, the task is marked `- [!]`, and a decision explains why (`CLAUDE.md` rule 8) |
| A named decision owner | the loop holder, through `loop/decisions.md` |

The trainer's cue for the demo: "Stop rather than weakening a test." D-020 shows the honest path. The spec revision
of 2026-11-17 changed AC-28 so that clearing `ip` and `ua` must succeed, which inverted one assertion in an existing test. T18 changed exactly the two
lines involved, kept every other assertion, and opened a decision so the holder could accept or reject the change.
It did not quietly rewrite the test. D-020 is still `OPEN`.

## 7. Accept a specific version

"Evidence identifies the same version." Here, every task is one commit, and its `merged` event in the ledger carries
the sha. A trainee PR names the sha its checks ran on (`CONTRIBUTING.md` §5).

The trainer's notes: "A commit or training-version label links evidence but does not prove correctness by itself."
In production, `/api/health` is planned to report the deployed sha (PR-04, task P01), and the planned observer check
O1 compares it with the sha the ledger says is live.

## 8. Behaviour checked after release

The build loop converged: 19 of 20 tasks merged unattended between 11:54 and 13:32. Its last task, T16, was a deploy.
`specs/prod-loop.md` §0 says why that is not the end: "Green tests describe a version on a laptop."

The holder decided on a production loop whose oracle is production itself (D-023, `specs/prod-loop.md`).
This is the design. It was not running on 2026-11-17: T16 and P01 … P06 were open, and the ledger had no
`deployed` event. Once it runs:

- every green `main` commit is deployed, then `smoke-remote.sh` (AC-39) runs against the live origin;
- a red smoke rolls back to the previous image and pauses autodeploy until the holder answers;
- an observer runs checks O1 … O7 every 10 minutes: health and version, TLS, spoofed IP headers, test surfaces,
  chain verify, error lines, backups. It logs only changes of state;
- O3, O4 or O5 red (the IP gate can be faked, a test bypass is live, the log was edited) pauses autodeploy and opens a
  decision at once.

Its tasks, P01 … P06, are in `loop/backlog-prod.md`. `loop/observe.sh summary` and the `deployed` events in the ledger
show how far it has got.

## 9. Lesson: improve the next task

"Turn the observed problem into a rule with a reason." The workshop asks four questions. `specs/prod-loop.md` §4.4
turns them into a rule for this repo: when production catches something the build oracle missed, the same task adds a
test that would have caught it in CI and a one-line rule in `apps/attendance/AGENTS.md`.

| Question | Where it is answered here |
|---|---|
| What happened? | the ledger event and the decision entry |
| What rule helps, and why? | one line with its reason in `apps/attendance/AGENTS.md` (app rules) or `CLAUDE.md` (repo rules) |
| Where will it be read or enforced? | `CLAUDE.md` is read by every session; a check in the oracle enforces it |
| How will we check it next time? | the new test, which runs in CI on every PR |

## 10. The human on the loop

`LOOPS.md` §3 lists everything the loop holder does. Everything else is the loop. On 2026-11-17 the holder:

- answered decisions in `loop/decisions.md`: D-002, D-003, D-005, D-006 and D-022, plus D-023 and D-024 below.
  He also wrote part of an answer to D-004 (the Google client), which stays `OPEN` because the Workspace domain
  restriction is still undecided;
- stopped the `meet` venture loop at 12:25, before any build started ("Stop the meet, no need for open loop").
  Its decisions D-007, D-014, D-015, D-018 and D-019 were set to `PARKED` (ledger, 12:25);
- steered the converged build loop into a production loop (D-023);
- chose that trainee PRs need his review before they reach production (D-024).

The app's code came from the loop: `git log` shows one `loop(Txx)` commit per task.

## 11. Your turn

The workshop ends with: "Write your next task, the proof you need, and a stopping condition."
[exercises.md](exercises.md) has small tasks in exactly that shape.
