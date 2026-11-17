# Guide for trainees

These pages are for people who took the workshop
[The Loop in Practice](https://mahranbayed.com/ai-talent-lab/?section=the-loop-workshop) and want to practise on a real system,
with their own agent. Each page points at real files, so you and your agent can check every claim.

| Page | Read it when |
|---|---|
| [the-loop-in-this-repo.md](the-loop-in-this-repo.md) | you want to see each idea from the workshop in a file you can open |
| [attendance-system.md](attendance-system.md) | you want to know what the app does, how it resists cheating, where it cannot, and how to run it |
| [exercises.md](exercises.md) | you are ready to run your own loop on one small task |

## A reading order

1. The repo [README](../../README.md): the 60-second picture and the repo map.
2. [the-loop-in-this-repo.md](the-loop-in-this-repo.md).
3. [CONTRIBUTING.md](../../CONTRIBUTING.md): how a PR carries its evidence.
4. One exercise from [exercises.md](exercises.md).

## For your agent

Point your agent at these files before it starts, in this order:

1. `CLAUDE.md`: the rules. They apply to your agent too.
2. `LOOPS.md`: why the rules exist.
3. The spec section your task touches, in `specs/attendance.md` or `specs/prod-loop.md`.
4. `CONTRIBUTING.md` sections 3 to 5: the brief, the stopping point, the evidence table.

Then tell it two things the rules alone do not say:

- **Do not pick a backlog task.** `CLAUDE.md` rule 1 and the SessionStart brief point at T16 (the production loop's
  first deploy) and M01 (meet, which the holder stopped at 12:25 UTC). Work only on your issue, exercise or decision
  entry (`CONTRIBUTING.md` §2).
- **Keep `loop/ledger.jsonl` out of the commit.** The SessionStart hook, `CLAUDE.md` rule 6 and the Stop gate all
  write to it locally. Run `git restore --staged --worktree loop/ledger.jsonl` before each commit (`CONTRIBUTING.md` §6).

## Elsewhere in the repo

- [docs/history/](../history/): every prompt the loop holder typed during the session.
- [docs/blog/](../blog/): the story of the session.
- `loop/decisions.md`: every question the loop could not decide, and the holder's answers.
- `loop/ledger.jsonl`: every loop event, with its time. `loop/observe.sh summary` reads it for you.

Source: *[The Loop Explained](https://aqaddoura.com/library/files/The-Loop-Explained-AR-v0.2.pdf)* by Ahmed Qaddoura (Arabic, v0.2).
