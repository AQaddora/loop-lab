# Timeline

One merged timeline of 2026-11-17, in UTC, from four sources: the human interactions in
[01-human-prompts.md](01-human-prompts.md), the session transcripts (orchestrator, build loop, side session),
the scaffold workflow's run record, and `loop/ledger.jsonl`. Ledger rows are copied from the ledger as it stood at
the snapshot (21:51:21 UTC, 91 lines); `start` and `test_pass` lines are left out to keep the table short.
Server names in the ledger rows from before 21:19 read as the orchestrator's aliasing pass rewrote them in
`loop/ledger.jsonl` itself at 21:19:07, not as `loop/log-event.sh` first wrote them (CLAUDE.md says only that script
writes the ledger). This folder applies the same aliases.

Two things to know when you read the ledger rows:

- Between 12:26 and 13:33 the build loop logged some questions under ids that the scaffold's integrator had already used
  (D-002 to D-006). At 13:33:56 it logged D-020 and D-021 as renumbered from the colliding D-003 and D-004, and D-022 for
  the port question. The real D-002 to D-006 are the integrator's entries in `loop/decisions.md`.
- The `merged` rows at 21:33:04 and 21:47:49 carry task `D-003`: commits `115f117` and `30b656e` are `loop(lab)` commits
  for the tailnet mirror, filed under that decision. They are not backlog tasks.

| UTC | Source | Event |
|---|---|---|
| 11:16:50 | human | [H01](01-human-prompts.md#h01--111650-utc--orchestrator--prompt) orchestrator prompt: "we are in live session explainning the loop in practice for loop explained this …" |
| 11:18:18 | orchestrator | creates `~/loop-lab` and runs `git init` |
| 11:21:06 | workflow | `loop-lab-scaffold` starts (run `wf_6316037a-16a`): `scaffold:attendance` and `scaffold:meet` start |
| 11:30:27 | human | [H02](01-human-prompts.md#h02--113027-utc--orchestrator--prompt) orchestrator prompt: "I have the complete env from the livekit cloud project in my clipboard take it from …" |
| 11:31:27 | workflow | `scaffold:meet` done (specs/meet.md, loop/backlog-meet.md, loop/ventures.md); `scaffold:harness` starts at 11:31:29 |
| 11:31:39 | human | [H03](01-human-prompts.md#h03--113139-utc--orchestrator--approval) orchestrator approval: "[approval dialog: granted computer-use access to TextEdit]" |
| 11:31:53 | human | [H04](01-human-prompts.md#h04--113153-utc--orchestrator--approval) orchestrator approval: "[approval dialog: approved full-screen control]" |
| 11:32:00 | orchestrator | reads the Mac clipboard once; full-screen control released at 11:32:07 |
| 11:32:45 | orchestrator | LiveKit values stored in the host-local secret store and checked live: list-rooms answered 200 |
| 11:33:02 | orchestrator | writes `loop/secrets.sh` (add, names, verify, link) |
| 11:34:05 | workflow | `scaffold:attendance` done (spec with AC-01…AC-39, 16-task backlog); `review:meet` starts |
| 11:36:04 | human | [H05](01-human-prompts.md#h05--113604-utc--orchestrator--prompt) orchestrator prompt: "[attached: the Google OAuth client file (client_secret_*.json); not published] take it …" |
| 11:36:21 | orchestrator | Google client stored and checked: `invalid_grant` to a fake code, so the ID and secret are valid |
| 11:38:55 | human | [H06](01-human-prompts.md#h06--113855-utc--orchestrator--prompt) orchestrator prompt: "added the http://localhost:3000/api/auth/callback/google to authorized redirect urls." |
| 11:39:30 | orchestrator | redirect check: the registered URI reaches the sign-in page, an unregistered one gets `redirect_uri_mismatch` |
| 11:39:58 | human | [H07](01-human-prompts.md#h07--113958-utc--orchestrator--prompt) orchestrator prompt: "deploy target is loop-runner staging, go domain under aqaddoura.com can we make it" |
| 11:42:52 | orchestrator | port check of loop-runner from another fleet box: 22 open, 80 and 443 closed or filtered |
| 11:43:17 | human | [H08](01-human-prompts.md#h08--114317-utc--orchestrator--mid-turn) orchestrator mid-turn: "no worries we serve it on the tailnet path" |
| 11:43:47 | orchestrator | nginx sites it had started to add are reverted |
| 11:43:54 | orchestrator | tries to mount `/attendance` and `/meet` with Tailscale Serve; Serve is not enabled for the tailnet; stopped at 11:46:07 |
| 11:46:24 | human | [H09](01-human-prompts.md#h09--114624-utc--orchestrator--mid-turn) orchestrator mid-turn: "build me artifact on both loops that are running and the prompt that creates them we …" |
| 11:47:40 | orchestrator | offers the attendance build loop as a session card |
| 11:47:48 | human | [H10](01-human-prompts.md#h10--114748-utc--orchestrator--choice) orchestrator choice: "[session card "Attendance build loop (T01 onward)": chose "New session"]" |
| 11:48:07 | orchestrator | sends the brief; session "Attendance build loop (T01 onward)" starts ([brief](prompts/attendance-build-loop-brief.md)) |
| 11:49:00 | human | [H11](01-human-prompts.md#h11--114900-utc--side--prompt) side prompt: "> loop/backlog-attendance.md open it on my mac" |
| 11:49:15 | side | sends `loop/backlog-attendance.md` to the holder as a file card |
| 11:49:52 | workflow | `review:meet` done (30 fixes, 8 left); `review:attendance` starts |
| 11:50:16 | orchestrator | publishes the showcase page, a private Claude artifact named "Loop Lab Live" |
| 11:50:35 | orchestrator | proposes the meet loop as a second session card ([brief](prompts/meet-loop-brief.md)); nobody starts it |
| 11:53:07 | workflow | `scaffold:harness` done; `review:harness` starts |
| 11:54:11 | ledger | `feature attendance T01 merged` 1cca1e4 scaffold Next 16 + vitest + playwright; AC-01 green |
| 11:58:00 | ledger | `feature attendance D-001 decision_needed` AC-36 vs spec 6.2: instrumentation throw makes bypassed prod server 500; applying A (keep throw, harness bypasses both guards) until answered |
| 11:58:00 | ledger | `feature attendance T02 merged` c65fb6a isTestMode gate + server clock + 2-layer prod boot guard; AC-08 green |
| 12:00:48 | ledger | `feature attendance T03 merged` bc79d9e drizzle schema (13 tables) + append-only triggers; AC-28 green |
| 12:03:23 | ledger | `feature attendance T04 merged` 9277aaa client IP + CIDR allowlist + rotating/static QR tokens; AC-02..05 green |
| 12:05:45 | workflow | `review:harness` done (14 fixes, 8 left) |
| 12:05:54 | ledger | `feature attendance T05 review_fail` self-review: chain head check mis-reported rows beyond the head |
| 12:05:54 | ledger | `feature attendance T05 fixed` head.seq \< rows -> head.seq+1; head hash mismatch -> last seq; tests added |
| 12:05:54 | ledger | `feature attendance T05 merged` 093d3cb HMAC hash chain + punch state machine + DB fixed-window limiter; AC-06,07,09 green |
| 12:11:10 | workflow | `review:attendance` done (25 fixes, 6 left; the spec grows to AC-01…AC-43 and the backlog to T01…T20 while T01–T05 are already merged); `integrate` starts |
| 12:18:10 | ledger | `feature lab D-002 decision_needed` 18 setup decisions queued D-002..D-019: Telegram pings, OD-1..OD-10, MEET-1..MEET-7; blockers D-003+D-004 -> T16, D-005..D-007 -> M05 |
| 12:18:21 | ledger | `feature attendance T06 review_fail` self-review vs revised spec: claims not normalised, bootstrap not step 0, prod check used /s; prod check leaked a server on :3200 |
| 12:18:21 | ledger | `feature attendance T06 fixed` src/lib/identity.ts Claims + step 0; /api/client-ip; reset {fixture}, clock {fixedMs}; check uses setsid process groups |
| 12:18:21 | ledger | `feature attendance T06 merged` e7d93ad Auth.js + one signIn policy + test harness + prod guard; AC-10,11,36 green |
| 12:19:20 | workflow | `loop-lab-scaffold` done: 7 agents, 323 tool calls, 3,494 s |
| 12:20:17 | orchestrator | writes answers into D-003, D-004, D-005 and D-006 in the holder's name, from his chat messages (H02, H05 to H08); parts of them it worked out itself (see 03-decisions.md); logged at 12:20:40 |
| 12:20:35 | ledger | `feature attendance T17 merged` ced2f27 AC coverage guard script; AC-40 green |
| 12:20:40 | ledger | `feature attendance D-003 decision_answered` deploy: loop-runner tailnet path /attendance via Tailscale Serve |
| 12:20:40 | ledger | `feature attendance D-004 decision_answered` Google client verified; staging redirect + hd restriction still open |
| 12:20:40 | ledger | `feature meet D-005 decision_answered` deploy: loop-runner tailnet path /meet via Tailscale Serve |
| 12:20:40 | ledger | `feature meet D-006 decision_answered` LiveKit project test-loops, verified status=200 |
| 12:21:37 | orchestrator | republishes the page: 7 of 20 tasks merged |
| 12:25:02 | human | [H12](01-human-prompts.md#h12--122502-utc--orchestrator--prompt) orchestrator prompt: "Stop the meet, no need for open loop" |
| 12:25:11 | orchestrator | withdraws the meet card; parks D-007, D-014, D-015, D-018, D-019 |
| 12:25:19 | ledger | `venture meet - blocked` holder stopped the meet open loop; D-007 D-014 D-015 D-018 D-019 PARKED, no build started |
| 12:25:21 | ledger | `feature attendance T18 test_fail` 2 assertions in the existing AC-28 test encode the pre-revision AC (ip=NULL must abort; 4 triggers) |
| 12:26:19 | ledger | `feature attendance D-002 decision_needed` tailnet staging needs 100.64/10 + fd7a:115c:a1e0::/48 allowlisted but revised AC-03 rejects them; blocks a useful T16 demo only |
| 12:26:19 | ledger | `feature attendance D-003 decision_needed` T18 updated 2 pre-revision assertions in the AC-28 test (ip=NULL now allowed; 6 triggers); accept? |
| 12:26:20 | ledger | `feature attendance T18 fixed` the 2 contradicting AC-28 assertions now follow the revised AC; D-003 logged |
| 12:26:20 | ledger | `feature attendance T18 merged` 3dd619f primitives at the revised spec: parseCidr, QR mode, chain anchor, stale IN, retention triggers |
| 12:32:15 | ledger | `feature attendance T07 review_fail` self-review: last-owner guard unreachable behind the self-action rule |
| 12:32:15 | ledger | `feature attendance T07 fixed` member rules ordered authz -> last-owner invariant -> self action, so both codes are reachable |
| 12:32:15 | ledger | `feature attendance T07 merged` 5c2bd35 Origin check + audit + bootstrap setup + org + member rules; AC-33,42,43 green |
| 12:35:30 | ledger | `feature attendance T19 merged` 631d3c2 admin sites + networks via parseCidr, audited; AC-31 green |
| 12:41:17 | ledger | `feature attendance T08 merged` abeca2e scan entry + tickets + static QR + CSP/headers; AC-12..15,38 green |
| 12:49:29 | ledger | `feature attendance D-004 decision_needed` Chromium 159 refuses UV=0 ceremonies on a UV-capable virtual authenticator; helper uses hasUserVerification=false for uv:false (AC-18 green) |
| 12:49:29 | ledger | `feature attendance T09 test_fail` AC-16 test hit the 10/min profile limit; AC-18 client refused UV=0 ceremony |
| 12:49:29 | ledger | `feature attendance T09 fixed` test moves to next window via setClock; authenticator without UV for UV=0 (D-004); code_mismatch is 400 per §5.3 |
| 12:49:29 | ledger | `feature attendance T09 merged` 4964ab7 onboarding + passkey registration PENDING + confirm code; AC-16,17,18,35 green |
| 12:52:48 | ledger | `feature attendance T10 merged` 7df53e9 approvals with confirm code, one-tx replace, audited; AC-20 green |
| 12:58:24 | ledger | `feature attendance T11 merged` 8ded1d6 punch in §2.5 order + atomic commitPunch + /me; AC-19,21,22,27,41 green |
| 13:02:18 | ledger | `feature attendance T20 merged` 244b4d9 punch abuse suite (replay, counter, tickets, IP, rate limits); AC-23,24,25,34 green |
| 13:06:24 | ledger | `feature attendance T12 test_fail` AC-26 second-phone test waited on a register button hidden by the waiting screen |
| 13:06:24 | ledger | `feature attendance T12 fixed` test taps 'Register a different passkey' like a user; e2e timeout 60 s for multi-context WebAuthn tests |
| 13:06:24 | ledger | `feature attendance T12 merged` 433ea51 new-device re-registration flow proven end to end; AC-26 green |
| 13:22:19 | ledger | `feature attendance T13 test_fail` whole e2e 35 red: next dev lazy compiles reloaded open pages mid page.evaluate (box under load) |
| 13:22:19 | ledger | `feature attendance T13 fixed` e2e/global-setup.ts compiles every route (server + client) before the first test; AC-32 test uses toHaveURL for client navigation |
| 13:22:19 | ledger | `feature attendance T13 merged` 606b96c kiosk pairing + rotating QR by server time; e2e route warm-up; AC-32 green |
| 13:27:37 | ledger | `feature attendance T14 merged` c476060 corrections + formula-safe CSV + verify UI; AC-29,30 green |
| 13:32:27 | ledger | `feature attendance T15 merged` 5be44a6 full journey green; whole oracle converged (74 e2e, 96 unit, coverage, prod guard) |
| 13:33:07 | ledger | `feature attendance D-005 decision_needed` OD-1 staging: tailscale serve has no config; pick port (3101 vs e2e/meet 3100), XFF hops=1 vs header, BASE_PATH vs own origin |
| 13:33:07 | ledger | `feature attendance D-006 decision_needed` OD-2: register https://loop-runner.\<tailnet>.ts.net/attendance/api/auth/callback/google in Google Console |
| 13:33:07 | ledger | `feature attendance T16 blocked` staging deploy waits on D-005 (Serve not enabled; port/IP-header/origin), D-006 (Google redirect URI), D-002 (tailnet CIDRs) |
| 13:33:56 | ledger | `feature attendance D-020 decision_needed` renumbered from a colliding D-003: T18 changed 2 pre-revision AC-28 assertions; accept? |
| 13:33:56 | ledger | `feature attendance D-021 decision_needed` renumbered from a colliding D-004: UV=0 needs an authenticator without UV (helper change); accept? |
| 13:33:56 | ledger | `feature attendance D-022 decision_needed` OD-1 follow-up: staging on 3100 collides with the E2E oracle and meet; move staging to 3101? |
| 13:34:08 | ledger | `feature attendance T16 blocked` staging deploy waits on: Tailscale Serve enabled (no serve config), D-004 (register staging Google redirect), D-022 (port 3100 clash); D-003 answered |
| 13:35:02 | build-loop | final report: 19 of 20 tasks done, T16 blocked; 96 unit and 74 e2e tests green, AC coverage and prod guard pass. The session then waits. |
| 20:13:47 | human | [H13](01-human-prompts.md#h13--201347-utc--orchestrator--prompt) orchestrator prompt: "how is it going update my artifact what is on me?" |
| 20:14:39 | orchestrator | re-runs the oracle independently: lint, typecheck, 96 unit, AC coverage, prod guard pass; all 74 e2e tests pass by 20:18 |
| 20:18:19 | orchestrator | republishes the page with "What's on the loop holder now" |
| 20:57:36 | human | [H14](01-human-prompts.md#h14--205736-utc--orchestrator--prompt) orchestrator prompt: "deploy on taqat academy apps.taqat.academy attendance.apps.taqat.academy and make the …" |
| 20:58:24 | human | [H15](01-human-prompts.md#h15--205824-utc--orchestrator--mid-turn) orchestrator mid-turn: "use oai gateway installed on the fleet on my api i guess" |
| 21:00:22 | orchestrator | subagent "Read the loop workshop lecture": the page's HTML holds only slide 1, so it could not read the lecture |
| 21:01:25 | orchestrator | extracts the workshop's English slide text from the page's script bundle (until 21:05) |
| 21:08:06 | orchestrator | asks two questions: the owner's Google account and how trainee PRs reach `main` |
| 21:15:24 | human | [H16](01-human-prompts.md#h16--211524-utc--orchestrator--answer) orchestrator answer: "answered: \<owner's Google account>" |
| 21:15:24 | human | [H17](01-human-prompts.md#h17--211524-utc--orchestrator--answer) orchestrator answer: "answered: Holder approves (Recommended)" |
| 21:16:48 | orchestrator | writes D-022 (moot), D-023, D-024 and the D-004 update into `loop/decisions.md`, in the holder's name; its D-003 edit did not stay (see 03-decisions.md) |
| 21:17:27 | human | [H18](01-human-prompts.md#h18--211727-utc--orchestrator--mid-turn) orchestrator mid-turn: "make the repo paths different from my servers i told telegram i guess itt is public …" |
| 21:17:27 | orchestrator | writes `specs/prod-loop.md`; `loop/backlog-prod.md` at 21:17:37 |
| 21:17:43 | ledger | `deploy attendance D-023 decision_answered` STEER: build loop converged at 19/20; holder drifts it into the production loop (specs/prod-loop.md), auto-deploy to attendance.apps.taqat.academy |
| 21:17:43 | ledger | `feature attendance T16 decision_answered` unblocked: target apps-host Dokku, own origin attendance.apps.taqat.academy (D-003 re-answered, D-022 moot) |
| 21:19:07 | orchestrator | replaces server names and paths with public aliases, with a one-off script, in the repo files git did not track yet (outside `apps/`). The script counted the matches per file: KICKOFF.md 6, README.md 2, loop/backlog-prod.md 1, loop/decisions.md 22, `loop/ledger.jsonl` 6, loop/secrets.sh 2, specs/meet.md 1, specs/prod-loop.md 12. The tracked `loop/backlog-attendance.md` follows at 21:19:13 |
| 21:20:34 | human | [H19](01-human-prompts.md#h19--212034-utc--build-loop--prompt) build-loop prompt: "how to enable serve state i added this to authorized redirect urls …" |
| 21:21:21 | build-loop | live redirect check: neither the tailnet nor the production callback is registered yet (`registered=false`) |
| 21:22:32 | workflow | `loop-lab-go-public` starts in the orchestrator |
| 21:22:52 | orchestrator | creates the Dokku app `attendance` on apps-host with its domain and a storage mount (confirmed 21:23:11) |
| 21:23:27 | orchestrator | generates the production secrets on loop-runner and sets them in the Dokku config (names and lengths printed only) |
| 21:23:44 | orchestrator | tells the fleet's control session that this session owns the repo and the deploy, and passes on H15 (sent 21:23:48) |
| 21:24:01 | orchestrator | creates the GitHub repo AQaddora/loop-lab as PRIVATE, to stay private until scanned |
| 21:24:27 | orchestrator | writes `loop/briefs/prod-loop-session.md` (edited 21:25:17) |
| 21:25:04 | orchestrator | adds `LOOP_NOTIFY_CMD` to `loop/log-event.sh` and tests it with a stub |
| 21:25:10 | orchestrator | removes the one test line its stub test had written to the ledger |
| 21:25:25 | human | [H20](01-human-prompts.md#h20--212525-utc--build-loop--prompt) build-loop prompt: "[pasted] sudo tailscale serve --bg --set-path /attendance …" |
| 21:25:26 | ledger | `feature lab D-002 decision_answered` A: holder pings via the host-local notifier for deployed\|blocked\|decision_needed |
| 21:25:35 | orchestrator | creates repo labels: loop-task, venture, decision-needed, production, good-first-loop |
| 21:26:07 | workflow | `loop-lab-go-public` stopped; relaunched at 21:26:28, 21:26:32 and 21:26:37 as three runs by track (t16 + ship, scan + docs, history + blog) |
| 21:27:45 | build-loop | starts a production build of `5be44a6` outside the repo for the tailnet mirror; asks two questions at 21:27:52 |
| 21:30:02 | human | [H21](01-human-prompts.md#h21--213002-utc--build-loop--answer) build-loop answer: "answered: I'll type it" |
| 21:30:02 | human | [H22](01-human-prompts.md#h22--213002-utc--build-loop--answer) build-loop answer: "answered: Add it (Recommended)" |
| 21:33:04 | ledger | `feature attendance D-003 merged` 115f117 ALLOW_TAILNET_CIDRS=1 (tailnet mirror only): parseCidr accepts blocks inside 100.64.0.0/10; check 103 unit green |
| 21:33:50 | build-loop | starts the tailnet mirror on port 3101 from the new release; at 21:34 it meets a sign-in error under `/attendance` and starts on a fix |
| 21:42:21 | human | [H23](01-human-prompts.md#h23--214221-utc--build-loop--mid-turn) build-loop mid-turn: "https://loop-runner.\<tailnet>.ts.net/attendance/api/auth/callback/google?iss=https://ac …" |
| 21:47:49 | ledger | `feature attendance D-003 merged` 30b656e BASE_PATH fixes: Auth.js callback under /attendance, redirectTo, no doubled redirect; 106 unit + e2e 27/27 |
| 21:49:31 | build-loop | reports the "Bad request" on Google sign-in fixed (`30b656e`); sign-in on the mirror waits for the owner's address |
| 21:51:21 | this file | snapshot of this history. The ledger has no `deployed` event yet, and the repo is not public yet. |

## The day in numbers

| What | Value | Source |
|---|---|---|
| Human interactions | 23 | [01-human-prompts.md](01-human-prompts.md) |
| Backlog tasks merged by the build loop | 19 of 20 (T16 left) | ledger `merged`, 11:54:11 to 13:32:27 |
| Longest stretch with no human message | 12:25 to 20:13 UTC | 01-human-prompts.md (H12 to H13) |
| Self-review or test failures the loop caught and fixed before merging | 7 tasks (T05, T06, T07, T09, T12, T13, T18) | ledger `fixed` |
| Tests at convergence | 96 unit, 74 e2e, AC coverage and prod guard green | ledger T15 `merged`, 13:32:27 |
| Scaffold workflow | 7 agents, 323 tool calls, 58 min | run record `wf_6316037a-16a` |
| Decisions in `loop/decisions.md` | 24: 7 ANSWERED, 5 PARKED, 12 OPEN | [03-decisions.md](03-decisions.md) |
| Deploys to production | 0 at the snapshot | ledger has no `deployed` event |
