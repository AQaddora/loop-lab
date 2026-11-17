# Contributing with an agent

This repo is built by loops, and you contribute the same way: you are the **requester**, your agent is the **implementer**,
and the CI oracle and the loop holder are the **reviewers**.

Two facts shape everything below:

- **A merge to `main` will deploy to production** (D-023). That is the decided design in `specs/prod-loop.md` §4:
  the production loop ships every green `main` commit to https://attendance.apps.taqat.academy and checks its
  behaviour after release. It was not running yet on 2026-11-17. The first deploy (T16) and the loop's own tasks
  (P01 … P06) were still open, and the ledger had no `deployed` event. To see what is live now, run
  `loop/observe.sh summary` and look for `deployed` events in `loop/ledger.jsonl`.
- **So the loop holder reviews and merges every PR** (D-024). A PR needs the CI `oracle` check green and the review of
  a CODEOWNER (`.github/CODEOWNERS`). Branch protection enforces both once backlog task P05 is done.

## 1. Fork and open the repo in Claude Code

```bash
git clone https://github.com/<your-account>/loop-lab && cd loop-lab
npm --prefix apps/attendance ci
(cd apps/attendance && npx playwright install chromium)
claude
```

`CLAUDE.md` is your agent's rulebook. Claude Code reads it at the start of every session, and the SessionStart hook
(`loop/hooks/session-start.sh`, needs `jq`) prints where the loop is. The hook also appends a `session_start` line
to `loop/ledger.jsonl`. That line stays on your machine (section 6). Ask your agent to read `CLAUDE.md`, `LOOPS.md`
and the spec section your task touches before it changes anything.

Run the oracle once before you change anything (section 5 lists the commands). That is your baseline:
if something is already red, you know it was not your change.

## 2. Pick one small task

Take **one** of these, and only one per PR:

1. **An issue labelled `loop-task`.** Comment that you are taking it, so two people do not race.
2. **An exercise** from [docs/guide/exercises.md](docs/guide/exercises.md). Each one has a check and a stopping point.
3. **Something new: propose it first.** Append a decision entry to `loop/decisions.md` in a small PR
   (format in section 7), with lettered options and a recommendation. For a feature idea, that entry is your venture
   proposal. Build it only after the holder answers.

**Do not pick a backlog task yourself.** `CLAUDE.md` rule 1 says "Take the first `- [ ]` task whose deps are all
`- [x]`", but for a trainee that rule points at the wrong work. On 2026-11-17 no backlog task was open to trainees:

- `loop/backlog-attendance.md`: the only open task is T16, the first production deploy. It needs the holder's servers.
- `loop/backlog-prod.md`: P01 … P06 are the production loop's tasks, on the same servers.
- `loop/backlog-meet.md`: **stopped.** The holder stopped the meet loop at 12:25 UTC ("Stop the meet, no need for
  open loop"; ledger, loop `venture`, event `blocked`). Do not take an M-task or build `apps/meet`.
  M01 also needs Docker and a local LiveKit server.

The SessionStart brief still prints `next: T16` and `next: M01`. Tell your agent to ignore both, and take one of
these tasks only when an issue hands it to you.

## 3. Write the brief before the agent starts

The workshop's rule: "Agree on the outcome and evidence before the agent starts." A brief has four boxes.

| Box | Question | Example (TH-23, CSV formula injection) |
|---|---|---|
| **Outcome** | what will be observably true? | `csvCell()` puts a leading `'` before a cell that starts with `+`, `-`, `@`, a tab or a CR, as spec §2.6 says |
| **Check** | which command proves it? It must fail before the work and pass after | `npm --prefix apps/attendance test -- tests/unit/csv.test.ts` (no such file yet, so it fails today) |
| **Boundary** | what may the agent edit, and what must it leave alone? | add `apps/attendance/tests/unit/csv.test.ts` for `csvCell()` in `src/lib/csv.ts`; app code only if the test finds a bug; never `specs/` or existing tests |
| **Evidence** | what will the PR show? | the check output for one commit, the full oracle table, what is still unverified |

Give the agent the brief as the prompt, for example:

```
Task: <outcome>. Done when: <check command> exits 0, and the full oracle in CONTRIBUTING.md section 5 is green.
This is not a backlog task: do not pick T16, a P-task or an M-task.
You may edit: <files>. Do not edit specs/, acceptance criteria, done-when lines or existing tests.
Repair budget: 2 attempts. If it is still red after that, stop and write a diagnosis. Never weaken a test.
Report: the commit sha, each check as PASS/FAIL/ERROR/SKIP with its command, and what you did not verify.
```

The trainer's notes put it this way: "Written instructions describe the boundary; tool permissions enforce it."
So also restrict the agent with `/permissions` (or the project settings) to the files and commands the brief allows.

## 4. Set a stopping point

- **Repair budget: 2 attempts.** This matches the workshop and `FIX_ROUNDS = 2` in `.claude/workflows/build-next.js`.
- After the second failed attempt, **stop**. Write a diagnosis: what fails, the exact output, what you tried, and your
  best guess at the cause. Open the PR as a draft, or add a decision entry. That is a good outcome, not a failure.
- **Never weaken the oracle to go green.** Never delete, skip (`.skip` `.only` `.fixme` `xit` `test.todo`) or loosen a
  test. Never edit `specs/`, an acceptance criterion or a `done when` line. `check-ac-coverage.sh` fails on skip markers,
  and the holder reads the diff. If a test or an AC looks wrong, open a decision instead.
- Test-only shortcuts (fake clock, test login, client-IP override) go only behind `isTestMode()` (`CLAUDE.md` rule 5).

## 5. Evidence for one specific commit

"A result is meaningful only within the checks actually performed." Your PR description must say which checks ran,
on which commit, and with what result.

1. Commit, then note the sha: `git rev-parse --short HEAD`.
2. Run every check from the repo root **on that commit**:

   ```bash
   bash loop/checks/secret-scan.sh                           # no secret, private name or personal email (PR-07)
   npm --prefix apps/attendance run check                    # lint + typecheck + unit
   bash apps/attendance/scripts/check-ac-coverage.sh         # every AC has a titled test; nothing skipped
   npm --prefix apps/attendance run e2e                      # Playwright, Chromium
   bash apps/attendance/scripts/check-prod-no-test-mode.sh   # the production build has no test bypass
   ```

   This is the order CI runs them in.

3. Fill the table in the PR template. Use exactly one status per check:

   | Status | Meaning |
   |---|---|
   | **PASS** | the criteria and the evidence are complete |
   | **FAIL** | a criterion or required evidence is missing |
   | **ERROR** | the check could not run (for example port 3100 was busy, or the browser did not start). This is not proof of a defect |
   | **SKIP** | the check does not apply. Say why |

4. Write down **what remains unverified**. The oracle uses stand-ins (spec §7.5): `test-login` replaces Google, and a
   virtual authenticator replaces the phone. Behaviour on the deployed origin (AC-39) is checked only after release.
5. If you push again, run the checks again and update the sha. Evidence for an older commit does not count.

## 6. Open the PR

- One task per PR. Name it like the loop's commits: `loop(<task or issue id>): <title>`.
- The PR template asks for the brief, the evidence table, the stopping point and what is unverified.
- The **CI oracle** (`.github/workflows/oracle.yml`) runs on your PR: the secret scan first, then lint, typecheck,
  unit, AC coverage, E2E and the prod guard. It uses no secrets and runs with a read-only token. If it fails, the
  Playwright report is attached to the run as an artifact.
- A PR's CI run uses the PR's own copy of the oracle: the workflow, `apps/attendance/scripts/`, the Playwright and
  Vitest configs, `loop/checks/` and `loop/hooks/`. So a PR could turn `oracle` green by changing the oracle. The
  oracle is only as trustworthy as the review of changes to it. If your PR touches any of these files, say which
  lines and why in the description.
- The **loop holder** reviews and merges (D-024).
- Production behaviour is checked after release by the production loop, not by you. Once that loop is running
  (P01 … P03), it deploys each merge, runs the remote smoke test and keeps observing it (`specs/prod-loop.md` §4.1
  and §4.3). A red smoke rolls back to the previous image and pauses autodeploy until the holder answers.
- **Keep `loop/ledger.jsonl` out of your PR** unless the issue asks for it. Your agent writes to it locally anyway:
  the SessionStart hook appends a `session_start` line on every session start, `CLAUDE.md` rule 6 tells the agent
  to log each loop event, and the Stop gate logs `blocked` when it gives up. Upstream appends to the ledger all the
  time, so those lines would conflict. Drop them before every commit, and before you pull or rebase:

  ```bash
  git restore --staged --worktree loop/ledger.jsonl   # back to the version in HEAD
  git status --short loop/ledger.jsonl                # prints nothing
  ```

  Do not use `git update-index --skip-worktree` for this: `git pull` then refuses whenever upstream changes the
  ledger. Your evidence lives in the PR description, not in the ledger.

## 7. Questions go to a decision entry, not to chat

The loop's rule is to never ask in chat (`CLAUDE.md` rule 3), and the same goes for you. Add an entry under **Queue**
in `loop/decisions.md`:

```
## D-0NN · <one question>
- app: attendance | status: OPEN
- context: what you found, with file and line references
- options: A) ... B) ...
- recommendation: one option, and the reason in one line
- answer: _(loop holder writes here)_
```

- The next id is the highest one plus 1. If another PR takes the same id first, renumber yours when you rebase.
  It happened during the build: a colliding D-003 and D-004 became D-020 and D-021 (ledger, 13:33 UTC).
- Only the holder sets `status:` and `answer:`.
- Never write a secret in it. Write "needs `AUTH_GOOGLE_SECRET`" instead.

## Never

- Never commit a secret, a `.env.local`, `node_modules`, build output (`.next*`), `test-results/` or a database file.
- Never write a real server name, an IP address or a personal email. The repo uses aliases (`loop-runner`, `apps-host`)
  and placeholders such as `<owner's Google account>`.
- Never test against the production origin. Use the local E2E fixtures ([SECURITY.md](SECURITY.md)).
- Never edit the harness (`CLAUDE.md`, `LOOPS.md`, `KICKOFF.md`, `.claude/**`, `loop/hooks/**`, `loop/*.sh`) unless an
  issue asks for exactly that.
