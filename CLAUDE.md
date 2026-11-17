# loop-lab: rules for every agent in this repo

This repo is built by loops (see LOOPS.md). The human is the **loop holder**: they design the loop and answer decisions.
They are not in the build path. You are usually running unattended inside a workflow, `/loop` or a scheduled routine.

## Sources of truth

| What | File | Who may change it |
|---|---|---|
| Behaviour + acceptance criteria (AC ids) | `specs/<app>.md` | **loop holder only** |
| Work order + done-when commands | `loop/backlog-<app>.md` | loop: tick `[x]`, block `[!]`, add answer notes, add venture tasks; the holder for anything else |
| Questions for the human | `loop/decisions.md` | loop appends entries + `- loop:` lines; only the holder sets `status:` / `answer:` |
| Venture pool (meet) | `loop/ventures.md` | the ideate + build-next workflows only |
| Event history | `loop/ledger.jsonl` | `loop/log-event.sh` only, never by hand |
| App code + tests | `apps/<app>/` | the loop, one task at a time |

If code and spec disagree, the spec wins. If the spec is wrong, ambiguous or missing something, open a decision. Do not guess.

## The rules

1. **One task per iteration, in order.** Take the first `- [ ]` task whose deps are all `- [x]`. Do only that task. No drive-by refactors and no starting the next task.
2. **Done = green oracle.** A task is done only when its `done when` command **and** the app's full gate both exit 0, run from the repo root.
   The full gate is the backlog header's global gate if it names one (attendance: `npm --prefix apps/attendance run check`; meet: `run verify` once M04 is done), else `npm --prefix apps/<app> test`.
3. **Never ask the human in chat during a loop.** Instead:
   append an entry to `loop/decisions.md` (format in that file) → `loop/log-event.sh <loop> <app> <D-id> decision_needed "<question>"` →
   mark the task `- [!]` if it blocks it → take the next unblocked task, or stop.
4. **Never cheat the oracle.** Never weaken, skip (`.skip` `.only` `.fixme` `xit` `test.todo`), delete or loosen a test to go green.
   Never edit an acceptance criterion, a `done when` command or anything in `specs/`. Only the loop holder edits ACs. If a test or AC looks wrong, open a decision.
5. **Test-only bypasses** (fake clock, test login, client-IP override, virtual authenticator hooks, test routes) sit only behind the app's single
   test switch: `NODE_ENV=test`, or the guard the spec defines (attendance: `isTestMode()`, spec §7.2, which is dead code in `next build`).
   They must be unreachable in a production build.
6. **Log every loop event** with `loop/log-event.sh <loop> <app> <task> <event> "<detail>"`:
   loops `inner|feature|venture|deploy` (apps `attendance|meet|lab`; harness-level events use app `lab`); events `start test_pass test_fail review_pass review_fail fixed merged deployed decision_needed decision_answered blocked done session_start`.
7. **Commits:** one per task, `loop(T03): <backlog title>` (meet: `loop(M06): …`); housekeeping uses `loop(lab): …`, `loop(venture): …` or `loop(ideate): …`.
   Never amend or rewrite merged history, and never force-push. Before you commit, `git status` must show no secret, `node_modules` or build output.
8. **A stuck attempt never stays on main.** If you must give up, park it: `git switch -c loop/blocked-<id>`, commit `wip(<id>): blocked attempt`,
   `git switch -` back, then mark the task `[!]` and open a decision. Main must stay green.
9. **Secrets** live only in `apps/<app>/.env.local` (gitignored; the holder fills it via `loop/secrets.sh add|link <app>`) or in the deploy host's env.
   Never put a secret in code, a commit, the ledger, decisions.md, test output or chat. `.env.example` lists names only. `.env.e2e` holds test-only values.
10. **Stop gate.** If `loop/.gate` exists, the Stop hook will not let you end a turn while that app's `npm test` is red (3 forced retries, then it logs `blocked`
    and does not force again until the code changes). It stands aside while a build-next iteration owns the tree (its builder logged `start "build-next: …"`
    and that task has no `merged`/`blocked` yet, < 2 h): the workflow's own oracle applies then, so do not edit `apps/` from another session meanwhile.
    Fix the code. Never touch tests, `loop/.gate*`, the ledger or the hooks to get past it.
11. **Do not edit the harness** (`CLAUDE.md`, `LOOPS.md`, `KICKOFF.md`, `.claude/**`, `loop/hooks/**`, `loop/*.sh`) unless the loop holder asks you directly in a non-loop session.

## Where things are

```
specs/<app>.md              what to build (ACs)          loop/decisions.md   holder's inbox
loop/backlog-<app>.md       what next (done-when)        loop/ledger.jsonl   what happened
apps/<app>/                 the code (created by loop)   loop/observe.sh     summary | live view
.claude/workflows/          build-next.js, ideate.js     loop/hooks/         session-start, stop-gate
```
