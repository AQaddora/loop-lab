# KICKOFF: copy-paste runbook

Open a **new Claude Code session in `~/loop-lab`**. The SessionStart hook prints where the loop is, so the session already knows the state.
Switch the session to **auto mode** (Shift+Tab), or allow edits and the needed commands with `/permissions`. A permission prompt is a human *in* the loop.

## Step 0: once, in a terminal (2 min)

```bash
cd ~/loop-lab
node -v && jq --version && docker --version          # node >= 20; docker runs meet's local LiveKit server
git add -- .gitignore README.md CLAUDE.md LOOPS.md KICKOFF.md specs loop .claude \
  && git commit -m "loop(lab): harness + specs" && git tag -f loop-baseline   # the reviewers diff specs against HEAD
loop/observe.sh summary                               # the starting picture
```

Add only the harness paths, never `git add -A`: if a loop iteration is mid-task, `-A` would sweep its uncommitted `apps/` work into this commit.
If the loop already merged tasks before this commit (as in this checkout, where T01-T05 landed first), `loop-baseline` includes them, so the reset at the bottom goes back to that point, not to an empty `apps/`.

Optional, but it is what makes the loop phone-first (decision D-002): Telegram pings on `merged | blocked | decision_needed | deployed`.

```bash
mkdir -p ~/.config/loop-lab && (umask 077; printf 'LOOP_TG_TOKEN=%s\nLOOP_TG_CHAT=%s\n' '<bot token>' '<chat id>' > ~/.config/loop-lab/loop.env)
```

Secrets, whenever the holder has them (never paste them into chat): `pbpaste | ssh <you>@loop-runner '~/loop-lab/loop/secrets.sh add attendance'`,
then `loop/secrets.sh link attendance` once `apps/attendance` exists, and `loop/secrets.sh verify attendance`.

**Observer tabs** (open these before you start):

| Tab | Command | Shows |
|---|---|---|
| 1 | `loop/observe.sh` | the live colored event stream |
| 2 | `watch -c -n 5 loop/observe.sh summary` | progress bars, next task, OPEN decisions, last commit |

## Loop 0: build the attendance base (feature loop, 3 iterations)

```bash
echo attendance > loop/.gate      # turns on the inner loop: this session cannot stop while apps/attendance tests are red
```

The gate stands aside while a build-next iteration is mid-task (ledger `start "build-next: …"` without `merged`/`blocked`):
the workflow's builder, fixer and test lens run the oracle themselves. It bites again once the run returns, so the session never ends on a red tree.
If the picker finds the specs and harness untracked, it commits them first (`loop(lab): baseline harness + specs`), so the anti-cheat `git diff HEAD -- specs` check works.

Prompt:

```
Run the build-next workflow with args {app:'attendance', max:3}
```

(Workflow tool by name `build-next`, or by scriptPath `.claude/workflows/build-next.js`.) Watch it with `/workflows`:
picker → builder → 3 reviewers (spec · security · tests) → fixer (≤2 rounds) → recorder → `git log --oneline`.

## Loop 1: let it repeat unattended

Self-paced (the model picks the next wake-up):

```
/loop run the build-next workflow for attendance with max 1; stop the loop when the backlog has no unblocked tasks
```

Fixed cadence:

```
/loop 20m run the build-next workflow for attendance with max 1, unless the previous build-next run is still running (then do nothing this tick); stop the loop when the backlog has no unblocked tasks
```

Prefer self-paced: a fixed cadence can fire while the last run is still building, and two runs on one tree pick the same task.

meet v0 runs the same way: `echo meet > loop/.gate`, then `Run the build-next workflow with args {app:'meet', max:4}`.
Run **one app's feature loop at a time** per checkout (they share the working tree, `loop/.gate` and the ports).

## Venture loop: meet grows from ideas

```
/loop 30m run the ideate workflow for meet with args {app:'meet', top:3}
```

Each run: 4 lens agents propose → dedupe → 3 judges score → the top 3 become `OPEN` entries in `loop/decisions.md`.
It skips itself while 3 venture decisions are waiting (WIP cap), so an unanswered inbox costs nothing.
Approved ventures become M-tasks on the next build-next run for meet, which then builds and (once MEET-1..3 are answered) deploys them.

## The loop holder answers a decision (the only manual step)

1. `loop/observe.sh summary` lists the OPEN decisions; open `loop/decisions.md`.
2. Change `status: OPEN` to `ANSWERED` (a question) or `APPROVED` / `REJECTED` / `PARKED` (a venture), and fill in `answer:`.
3. `loop/log-event.sh feature attendance D-003 decision_answered "ANSWERED: A"` (use `venture meet` for ventures), so it shows in the live view.
4. Nothing else. The next run unblocks the `[!]` task or converts the venture, and logs what it did as a `- loop:` line under your answer.

## Overnight / in the cloud

```
/schedule every 2 hours: in the loop-lab repo run the build-next workflow with args {app:'attendance', max:2}, then git push. Do nothing if loop/backlog-attendance.md has no unblocked task.
```

A cloud routine works on a clone, so first add a git remote and push. Put the secrets in the routine's environment, not in the repo.
The project hooks run there too (they need `jq`). Locally, `/loop` only runs while the session is open.

## Observe

| Question | Command |
|---|---|
| What is happening right now? | `loop/observe.sh` (live) |
| How far along is it? | `loop/observe.sh summary` |
| Which agents are running? | `/workflows` |
| What landed? | `git log --oneline --decorate -20` · `git branch --list 'loop/blocked-*'` |
| What does it need from me? | `loop/decisions.md` (and Telegram) |
| What does a new session see? | `loop/hooks/session-start.sh </dev/null` (a preview: it logs `session_start` only when Claude Code runs it) |
| Where does it struggle? | `jq -s 'map(select(.event=="test_fail" or .event=="review_fail")) \| group_by(.task) \| map({task: .[0].task, n: length})' loop/ledger.jsonl` |

## 60-second inner-loop demo (after T01 is merged)

1. `echo attendance > loop/.gate`
2. Break one line in `apps/attendance/src/` that a unit test covers (e.g. flip a comparison).
3. Prompt: `Say hello and stop.`
4. Watch: the Stop hook runs `npm test`, it is red, the hook logs `test_fail` and hands Claude the failure, Claude fixes the bug, `test_pass`, and only then does it stop.

Do it while **no build-next iteration is mid-task** (after Loop 0 returns, or between `/loop` ticks): during one the gate stands aside, and you would be editing under the builder.
To demo it while Loop 0 keeps running, use a second checkout: `git worktree add ../loop-lab-demo && cd ../loop-lab-demo && npm --prefix apps/attendance ci`, then steps 1-4 there (needs the harness committed, Step 0; it has its own `loop/`, so watch it with its own `loop/observe.sh`).

## Live session run-of-show (about 30 min)

| Min | Beat | Show |
|---|---|---|
| 0-3 | a loop in one sentence + the 6 properties | LOOPS.md §1-2 |
| 3-6 | the spec *is* the oracle | `specs/attendance.md` §7-8, a `done when` line |
| 6-12 | Loop 0 live | the build-next prompt, then `/workflows` + the observer tabs |
| 12-15 | memory | `loop/observe.sh summary` · `git log` · a fresh session that already knows the state |
| 15-18 | inner loop | the 60-second demo above |
| 18-22 | escalation, human on the loop | a `[!]` task (T16 waits on OD-1 = D-003 and OD-2 = D-004) → answer both in decisions.md → the next run unblocks it |
| 22-26 | the open loop | run ideate for meet; approve one venture on stage |
| 26-30 | the dial + failure modes | LOOPS.md §4-5; leave `/loop` running for the night |

## Stop or reset

| Goal | Command |
|---|---|
| pause the inner loop | `rm loop/.gate` |
| stop a `/loop` | press Esc in that session, or ask it to stop the loop |
| reset the demo (**destroys** loop work) | `git reset --hard loop-baseline && git clean -fd apps/ && rm -f loop/.gate loop/.gate-* && git branch --list 'loop/blocked-*' \| xargs -r git branch -D` |
