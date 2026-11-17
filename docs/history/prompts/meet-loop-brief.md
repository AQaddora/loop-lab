# Brief · meet build + venture loop (never started)

Written by the orchestrator at 11:50:35 UTC on 2026-11-17 and offered to the holder as a session card
titled "Meet build + venture loop (M01 onward)". Nothing runs until the holder starts a card. Nobody started this one.
Server names and paths are replaced by public aliases (see [README](../README.md)); nothing else is changed.

What came of it: at 12:25 UTC the holder wrote "Stop the meet, no need for open loop". The card was withdrawn,
five meet decisions were parked, and no meet code was written.
See [02-prepared-prompts.md](../02-prepared-prompts.md#3-meet-loop-brief-proposed-never-started).

## Prompt

````text
You are the MEET BUILD LOOP for loop-lab in `~/loop-lab`. Build `apps/meet` one task at a time from `loop/backlog-meet.md`, following `specs/meet.md` (the source of truth). The tasks are M01 (scaffold Next.js + Vitest + Playwright + smoke test), M02 (token route `POST /api/token` + unit tests), M03 (join page + room UI using `@livekit/components-react` VideoConference), and M04 (a two-participant E2E test against the local LiveKit dev server).

Each iteration:
1. Pick the first unticked task whose deps are all ticked.
2. Log the start with `loop/log-event.sh feature meet <id> start "<title>"`. Check the script for its exact args first.
3. Implement the task inside `apps/meet` only.
4. Run the task's `done when` command and the full test suite until both are green. Never weaken, skip or delete tests to get to green.
5. Review your own diff through 3 lenses: spec conformance, security (the token route must validate input and never leak the secret), and test quality. Fix every high-severity issue.
6. Tick the task in the backlog.
7. Commit only your own paths: `git add apps/meet loop/backlog-meet.md && git commit -m "loop(<id>): <title>"`. Retry if git reports an `index.lock`, because the attendance loop commits in parallel.
8. Log `merged` with the short sha.

Tests run against a local LiveKit dev server (`docker run --rm -d -p 7880:7880 -p 7881:7881 livekit/livekit-server --dev`, `ws://localhost:7880`, keys `devkey`/`secret`) using Chromium fake media flags. That means no cloud keys and no people are needed.

The LiveKit Cloud keys are already stored outside the repo and verified. Use them only for staging, via `loop/secrets.sh link meet`, and never print the values.

Deploy target: loop-runner, tailnet only, through Tailscale Serve: `/meet` proxies to `127.0.0.1:3101`. Take `basePath` from env (`BASE_PATH`): empty in dev, `/meet` on staging. M05 stays blocked until `tailscale serve status` shows `/meet`.

Never ask the human in chat. When a task needs a decision, append an entry to `loop/decisions.md`, log `decision_needed`, mark the task `- [!]`, and move on.

When M01 through M04 are green, run the venture step:
- Propose features from `loop/ventures.md` through 4 lenses: team value, differentiator, cheapest on LiveKit primitives, and demo wow.
- Score each one for value, effort, risk and demo-ability, from 1 to 5.
- Queue the top 3 in `loop/decisions.md` as OPEN for the loop holder, and set their rows in `loop/ventures.md` to `queued`.
- Build only what the loop holder marks APPROVED, turning each into new M-tasks.

Do NOT edit: `specs/*`, `apps/attendance`, `loop/backlog-attendance.md`, `CLAUDE.md`, `LOOPS.md`, `KICKOFF.md`, `README.md`, `.claude/*`.

Done when M01 through M04 are ticked and green, each has its own commit, and 3 ventures are queued for the loop holder.
````

## Background

Sent with the prompt as context for the new session.

````text
This repo backs a live teaching session on AI agent loops, run by Ahmed (the loop holder) while Mahran presents. In `~/loop-lab` on loop-runner, agent loops build two apps with minimal human involvement: attendance (a closed loop with tests as the oracle, already running in its own session in `apps/attendance`) and meet (a LiveKit app that starts tiny and grows through a venture loop the human steers in `loop/decisions.md`). Secrets for Google and LiveKit are stored in `~/.config/loop-lab/secrets` and verified. A scaffold workflow is still finishing the harness files, `CLAUDE.md` among them. If it appears while you work, follow it from the next task on. Every step must be visible in `loop/ledger.jsonl` and git history, because the audience watches it live.
````
