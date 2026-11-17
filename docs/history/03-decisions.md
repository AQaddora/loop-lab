# The holder's decisions

By rule, a loop never asks the holder in chat (CLAUDE.md rule 3). It writes a question to `loop/decisions.md`, the
holder's inbox, and moves on.
This file lists every answer the holder gave on 2026-11-17: the entries in that inbox, and the answers he gave in chat
or in a question card that never became an entry. Times are UTC. Statuses are as read from `loop/decisions.md` at the
snapshot (21:51 UTC); the file has 24 entries: 7 ANSWERED, 5 PARKED, 12 OPEN.

How the answers got there: the holder answered in chat or in a question card. The orchestrator then wrote the answers
into `loop/decisions.md` in his name, as `(holder, 2026-11-17)`. For some entries it worked out the answer itself:
the holder's words picked no option, or did not touch the question at all. So the table below keeps two things apart:
what the holder said or picked, quoted with its H-number, and what an agent worked out and wrote. The five PARKED
statuses were set by the orchestrator after the holder wrote "Stop the meet, no need for open loop" (H12).
The H-numbers link to [01-human-prompts.md](01-human-prompts.md).

## The closing decision: D-023, steering

> mark last decision is this steering drifintg the loop into different loop, with production observation building started.. spec that and dispatch it auto deploy to apps.taqat.academy..

(part of [H14](01-human-prompts.md#h14--205736-utc--orchestrator--prompt), 20:57:36)

- **Question:** the build loop converged. Drift it into a production loop?
- **Answer:** the holder's words above. He named this the last decision himself. The orchestrator wrote the entry,
  with the question and options A and B, and filed his words as B, steer: written at 21:16:48, logged at 21:17:43
  (ledger `deploy attendance D-023 decision_answered`).
- **Why it matters:** the build loop's oracle was "the tests are green". It merged 19 of 20 tasks with no human, and
  then stopped at T16, the deploy. Green tests describe a version on one machine. They do not say whether the running
  version still works. The holder changed what "done" means: the new loop's oracle is production itself, with its
  behavior checked after every release (`specs/prod-loop.md` §0 and §1). In the lecture's five stations, the build loop
  covered Task, Agent and Review; this decision opens Deploy and Lesson.
- **What it started:** `specs/prod-loop.md`, `loop/backlog-prod.md` (P01–P06) and the brief
  `loop/briefs/prod-loop-session.md`. T16 was unblocked for apps-host at 21:17:43. At the snapshot nothing was deployed yet.

## Every entry in `loop/decisions.md`

| Id | Question | Status | What the holder said or picked | What an agent worked out and wrote | When (UTC) |
|---|---|---|---|---|---|
| D-001 | AC-36 vs §6.2: may the boot guard stop a bypassed prod server from serving? | OPEN | nothing | the build loop applies option A (fail closed) until it is answered | opened by the build loop 11:58:00 |
| D-002 | Telegram pings for merged, blocked, decision_needed and deployed? | ANSWERED | said, quoted: "let me know when a live link is there on telegram as escelate e.g." ([H18](01-human-prompts.md#h18--211727-utc--orchestrator--mid-turn)). He picked no option. | the orchestrator: option A, through the fleet's existing Telegram sender, so no new bot token; pings for `deployed` (with the live link), `blocked` and `decision_needed`, not for `merged` | said 21:17:27; written 21:25:22; ledger 21:25:26 |
| D-003 | OD-1 · deploy target, client-IP source and staging origin | ANSWERED | said, quoted, three times. First: "deploy target is loop-runner staging" ([H07](01-human-prompts.md#h07--113958-utc--orchestrator--prompt)) and "no worries we serve it on the tailnet path" ([H08](01-human-prompts.md#h08--114317-utc--orchestrator--mid-turn)). Then: "deploy on taqat academy apps.taqat.academy attendance.apps.taqat.academy" ([H14](01-human-prompts.md#h14--205736-utc--orchestrator--prompt)). Then: "keep both i will check on my tailnet hosted and the prod is on the apps.." ([H20](01-human-prompts.md#h20--212525-utc--build-loop--prompt)). He picked no option. | the orchestrator: the tailnet setup in the entry (`/attendance` through Tailscale Serve, `BASE_PATH`, port 3100, the env-gated `ALLOW_TAILNET_CIDRS=1`) and the line "The holder accepts TH-25", which he did not say; later, production on apps-host (Dokku) at its own origin. See the note below. | ledger 12:20:40; ledger 21:17:43; said 21:25:25 |
| D-004 | OD-2 · Google OAuth client and Workspace domain restriction | OPEN, partly answered | did: he gave the client file ("take it its for demo no worries ..", [H05](01-human-prompts.md#h05--113604-utc--orchestrator--prompt)) and registered the localhost redirect ([H06](01-human-prompts.md#h06--113855-utc--orchestrator--prompt)) | the orchestrator: the client is done and checked live; "the holder registers" the production redirect, a step for him written into his answer; the domain restriction stays open, so the spec default A applies (any Google account, gated by the member allowlist) | ledger 12:20:40; updated 21:16:48 |
| D-005 | MEET-1 · where should meet's staging run? | ANSWERED | the same two messages as D-003 ([H07](01-human-prompts.md#h07--113958-utc--orchestrator--prompt), [H08](01-human-prompts.md#h08--114317-utc--orchestrator--mid-turn)); neither names meet | the orchestrator applied them to meet: option C, varied, loop-runner, tailnet only, `/meet` through Tailscale Serve. Meet was stopped later (H12). | ledger 12:20:40 |
| D-006 | MEET-2 · which LiveKit Cloud project holds the staging keys? | ANSWERED | said, quoted: "I have the complete env from the livekit cloud project in my clipboard take it from there safely to the runner and use them in meetings project" ([H02](01-human-prompts.md#h02--113027-utc--orchestrator--prompt)). He picked no option and said nothing about rotating the secret. | the orchestrator: option A (in the entry, a new dedicated `loop-lab-staging` project), recorded as the dedicated test project `test-loops`, checked live (`status=200`); and the advice "Rotate the secret after the live session" | written 12:20:33; ledger 12:20:40 |
| D-007 | MEET-3 · staging access policy | PARKED | "Stop the meet, no need for open loop" ([H12](01-human-prompts.md#h12--122502-utc--orchestrator--prompt)) | the orchestrator set it to PARKED, with the four other meet entries below | ledger 12:25:19 |
| D-008 | OD-9 · missed check-out policy | OPEN | nothing | nothing; nothing is blocked | |
| D-009 | OD-5 · data retention periods | OPEN | nothing | nothing; nothing is blocked | |
| D-010 | OD-6 · external anchoring of the log head hash | OPEN | nothing | nothing; nothing is blocked | |
| D-011 | OD-3 · default QR mode for new sites | OPEN | nothing | nothing; nothing is blocked | |
| D-012 | OD-4 · allow synced passkeys | OPEN | nothing | nothing; nothing is blocked | |
| D-013 | OD-10 · four-eyes rule for credential approvals | OPEN | nothing | nothing; nothing is blocked | |
| D-014 | MEET-4 · venture autonomy level | PARKED | as D-007 (H12) | the orchestrator set it to PARKED | ledger 12:25:19 |
| D-015 | MEET-5 · ventures whose oracle needs LiveKit Cloud | PARKED | as D-007 (H12) | the orchestrator set it to PARKED | ledger 12:25:19 |
| D-016 | OD-8 · admin passkey step-up for approve, revoke and correct | OPEN | nothing | nothing; nothing is blocked | |
| D-017 | OD-7 · buddy-punch control beyond software | OPEN | nothing | nothing; nothing is blocked | |
| D-018 | MEET-6 · when to provide keys for AI ventures | PARKED | as D-007 (H12) | the orchestrator set it to PARKED | ledger 12:25:19 |
| D-019 | MEET-7 · where an Agents worker would run | PARKED | as D-007 (H12) | the orchestrator set it to PARKED | ledger 12:25:19 |
| D-020 | T18 changed 2 assertions of an existing AC-28 test: accept? | OPEN | nothing | nothing | opened by the build loop 13:33:56 |
| D-021 | §7.1 helper: a UV=0 registration needs an authenticator without UV: accept? | OPEN | nothing | nothing | opened by the build loop 13:33:56 |
| D-022 | OD-1 · staging port 3100 collides with the E2E oracle: move to 3101? | ANSWERED | nothing: he did not answer this question | the orchestrator ruled it moot from [H14](01-human-prompts.md#h14--205736-utc--orchestrator--prompt) and wrote that in his name: D-003 now deploys to apps-host, and port 3100 on loop-runner stays the E2E oracle's | written 21:16:48 |
| D-023 | STEER · drift the converged build loop into a production loop? | ANSWERED | said, quoted: "mark last decision is this steering drifintg the loop into different loop, with production observation building started.." ([H14](01-human-prompts.md#h14--205736-utc--orchestrator--prompt)) | the orchestrator wrote the entry and its options, and filed his words as B, steer (the closing decision, above) | written 21:16:48; ledger 21:17:43 |
| D-024 | PROD-1 · how do trainees' agent PRs reach `main`? | ANSWERED | picked "Holder approves (Recommended)" in a question card ([H17](01-human-prompts.md#h17--211524-utc--orchestrator--answer)). The option read: "Each PR needs the CI oracle to pass and your approval before it merges." | the orchestrator: option A, made concrete as branch protection on `main` with a CODEOWNER review (task P05 in `loop/backlog-prod.md`, not done at the snapshot); and "The fleet's own loop commits as the repo owner", which the holder did not say | answered 21:15:24; written 21:16:48 |

The scaffold's integrator queued D-002 to D-019 at 12:18:10. The build loop opened D-001 (11:58:00) and D-020 to D-022
(13:33:56). The orchestrator wrote D-023 and D-024 from the holder's words.

**Note on D-003.** At 21:16:48 the orchestrator ran an edit meant to replace the D-003 answer with the production answer
(apps-host, own origin). As read at the snapshot, the D-003 entry in `loop/decisions.md` still shows only the first,
tailnet answer. The production answer is recorded elsewhere: the ledger at 21:17:43 ("D-003 re-answered, D-022 moot"),
the D-022 answer, the T16 notes in `loop/backlog-attendance.md`, and `specs/prod-loop.md` §3. Two commits for the
tailnet mirror are also filed under D-003: `115f117` (`ALLOW_TAILNET_CIDRS`, 21:33:04) and `30b656e` (`BASE_PATH` fixes, 21:47:49).

## Answers given in chat or in a question card

These never became their own entry in `loop/decisions.md`.

| When (UTC) | Asked | The holder's answer | What it changed |
|---|---|---|---|
| 11:47:48 | session card "Attendance build loop (T01 onward)" | "New session" ([H10](01-human-prompts.md#h10--114748-utc--orchestrator--choice)) | the build loop started in its own session at 11:48:07 |
| 12:25:02 | (no question; he decided) | "Stop the meet, no need for open loop" ([H12](01-human-prompts.md#h12--122502-utc--orchestrator--prompt)) | the meet card was withdrawn and five meet decisions parked |
| 21:15:24 | which Google account owns the organization on attendance.apps.taqat.academy? | his main Google account, the first of two options ([H16](01-human-prompts.md#h16--211524-utc--orchestrator--answer)) | it is the `BOOTSTRAP_OWNER_EMAIL` in the Dokku config and the host-local secret store (`specs/prod-loop.md` §3), never in the repo |
| 21:25:25 | (no question; he decided) | "keep both i will check on my tailnet hosted and the prod is on the apps.. same are mirrored currently" ([H20](01-human-prompts.md#h20--212525-utc--build-loop--prompt)) | the tailnet path stays as a mirror next to production |
| 21:30:02 | which Google account owns the tailnet mirror? | "I'll type it" ([H21](01-human-prompts.md#h21--213002-utc--build-loop--answer)) | waiting: the address had not arrived by the snapshot |
| 21:30:02 | add the env-gated `ALLOW_TAILNET_CIDRS=1` for the tailnet mirror? | "Add it (Recommended)" ([H22](01-human-prompts.md#h22--213002-utc--build-loop--answer)) | commit `115f117`, ledger `merged` 21:33:04 |

## What the holder did not have to decide

Between 11:48 and 13:35 the build loop asked nothing in chat. In that time it merged 19 tasks, opened four questions in
the inbox (D-001, D-020, D-021, D-022) and stopped at the one task it could not finish alone. None of its questions
blocked work until T16. Later, at 21:27:52, it asked two questions in chat (H21, H22), while the holder was talking to
it directly. In the lecture's terms, the holder was the requester. The agents were the implementers and the first
reviewers. From now on the holder is the last reviewer of every trainee PR (D-024).
