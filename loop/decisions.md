# Decisions: the loop holder's inbox

The loop never asks a question in chat. When an agent needs a human, it appends an entry here, logs `decision_needed`,
marks the task `- [!]` if it blocks one, and then takes the next unblocked task or stops. This file is the **escalation path**.

## How the loop holder answers (about 30 seconds)

1. Find an entry with `status: OPEN` (`loop/observe.sh summary` lists them).
2. Change **only** `status:` and `answer:`. The answer may add constraints, e.g. "A, but no new npm deps".
3. Optional, so it shows up in the live view: `loop/log-event.sh feature <app> D-004 decision_answered "APPROVED"`.
4. Done. The next `build-next` / `ideate` run applies it.

| Status | Set by | Meaning | What the loop does next |
|---|---|---|---|
| `OPEN` | loop | waiting for the holder | nothing; blocked tasks stay `- [!]` |
| `ANSWERED` | holder | a question is answered | build-next unblocks the waiting task (`- [!]` → `- [ ]`) and copies the answer into its notes |
| `APPROVED` | holder | venture (meet): build it | build-next adds 1-3 M-tasks under "Venture tasks"; ventures.md → `approved` |
| `REJECTED` | holder | drop it | ventures.md → `rejected`; an already-built venture is reverted (an L2 veto) |
| `PARKED` | holder | not now | ventures.md → `pool (cooldown 3)`; the waiting task stays `- [!]` |

## Rules

- Ids are `D-001`, `D-002`, … in order. The next id is the highest one plus 1, and ids are never reused.
- One question per entry. Options are lettered. The recommendation names one option and gives the reason in one line.
- If a question comes from a spec's open-decisions table, put the spec id in the title: `## D-003 · OD-1 · Deploy target?` or `## D-005 · MEET-2 · Which LiveKit Cloud project?`.
- A venture entry names its V-id in the title: `## D-012 · Build V-02 Emoji reactions?`. Only these count toward ideate's WIP cap of 3.
- Agents append below **Queue** and never edit the holder's `status:` or `answer:`. After acting on an answer, the loop adds
  one last line `- loop: <what it did>` (e.g. `- loop: unblocked T16`, `- loop: converted -> M06, M07`). An entry with a `- loop:` line is closed.
- Never write a secret here. Write "needs `AUTH_GOOGLE_SECRET` via `loop/secrets.sh add attendance`" instead.

## Format

```
## D-001 · <question>
- app: attendance | status: OPEN
- context: ...
- options: A) ... B) ...
- recommendation: ...
- answer: _(loop holder writes here)_
```

## Queue

<!-- entries are appended below, oldest first -->

## D-001 · AC-36 vs §6.2: may the instrumentation boot guard stop a bypassed prod server from serving?
- app: attendance | status: OPEN
- context: spec §6.2 says `src/instrumentation.ts` "logs + throws if prod && AUTH_TEST_MODE". Measured on Next 16.4.6: a throw in `register()` leaves `next start` running but every request returns 500. Spec §7.4 step 3 (AC-36) runs `AUTH_TEST_MODE=1 npx next start` "deliberately bypassing the guard" and expects `/api/test/*` 404, no `test-login` provider and `data-error="ip_unknown"`, which cannot happen while that throw is active. Until this is answered the loop applies A (the more restrictive reading). Nothing is blocked.
- options: A) keep the throw (fail closed). `scripts/check-prod-no-test-mode.sh` step 3 bypasses BOTH guards from outside the app (a preload in `scripts/` that injects `AUTH_TEST_MODE=1` into the running server on its first request, after `register()` has run), and an extra step checks that a plain bypassed `next start` serves no 2xx. B) instrumentation only logs (no throw), and §7.4 step 3 runs exactly as written. C) the holder edits §6.2 / §7.4.
- recommendation: A. It keeps both boot-guard layers and still proves the dead-code property AC-36 is after.
- answer: _(loop holder writes here)_

## D-002 · Should the loop send Telegram pings for merged, blocked, decision_needed and deployed?
- app: lab | status: ANSWERED
- context: Answer this one first (KICKOFF.md step 0). The pings are how the holder hears about every entry below. `loop/log-event.sh` already supports them and pings only when `LOOP_TG_TOKEN` and `LOOP_TG_CHAT` are set, in the env or in `~/.config/loop-lab/loop.env` (mode 600). That file does not exist yet, so pings are off. A failed ping never fails the caller. Without pings the holder has to watch `loop/observe.sh` to notice new decisions, and `[!]` tasks wait while nobody is at the terminal.
- options: A) Yes: the holder writes a bot token and chat id to `~/.config/loop-lab/loop.env` (the command is in KICKOFF.md step 0). B) No: watch the terminal only.
- recommendation: A. The holder hears about decisions on their phone, so the loop does not wait on an empty terminal.
- answer: (holder, 2026-11-17, live: "let me know when a live link is there on telegram as escelate e.g.") **A, through the fleet's existing Telegram sender**, so no new bot token. `loop/log-event.sh` now also accepts `LOOP_NOTIFY_CMD`, a host-local command that reads the text on stdin, from `~/.config/loop-lab/loop.env`. Events: `deployed` (it carries the live link), `blocked` and `decision_needed`. `merged` is left out to keep the pings to escalations.

## D-003 · OD-1 · Deploy target, client-IP source and staging origin?
- app: attendance | status: ANSWERED
- context: Blocks T16 (`- [!]`). The IP allowlist can only be trusted if the client IP comes from our own proxy, which overwrites the header, and if the app port is firewalled (spec §2.2; AC-39 checks both from outside). The choice sets `TRUSTED_IP_HEADER` / `TRUSTED_PROXY_HOPS`, the DB (SQLite or Postgres), `ORIGIN_PORT`, `AUTH_URL` and the WebAuthn rpID (the staging domain). Serving it under `BASE_PATH` on a shared host puts every neighbour app inside the trust boundary (TH-25).
- options: A) VPS + Caddy (auto-TLS, overwrites XFF), SQLite file, `TRUSTED_PROXY_HOPS=1`, app port firewalled. B) Fly.io (`fly-client-ip`), SQLite on a volume. C) Vercel + Postgres (`x-real-ip`; needs an extra schema-port task). The answer also names the origin: its own subdomain (`BASE_PATH` empty) or `BASE_PATH` on a shared host.
- recommendation: A on its own subdomain. It is one box with no DB service, the IP-trust story is the simplest to explain on stage, and there are no same-origin neighbours.
- answer: **Production (holder, 2026-11-17 20:57, live: "deploy on taqat academy apps.taqat.academy attendance.apps.taqat.academy"; settings written by the orchestrator):** apps-host (Dokku) at its own origin `https://attendance.apps.taqat.academy`. `BASE_PATH` is empty, `AUTH_URL` and the WebAuthn origin are `https://attendance.apps.taqat.academy`, and the rpID is `attendance.apps.taqat.academy`. SQLite sits on a Dokku persistent mount, with Let's Encrypt TLS. Client IP: Dokku's nginx overwrites `X-Forwarded-For` with `$remote_addr`, so `TRUSTED_IP_HEADER` stays empty and `TRUSTED_PROXY_HOPS=1`. The container port is never published on the host, and AC-39 checks that from outside. Own origin removes TH-25. The image is built on loop-runner from a clean `git archive` of one commit and shipped with `dokku git:from-image`. The owner's Google account goes in the deploy env only. **Tailnet mirror (the first answer, still running as a separate copy):** (holder, 2026-11-17) loop-runner staging, **tailnet only**, on a path. Serve it at `https://loop-runner.<tailnet>.ts.net/attendance` with Tailscale Serve, mounted `/attendance` → `http://127.0.0.1:3100/attendance` (no nginx, Caddy or public DNS; loop-runner's AWS security group only opens 22). Settings: `BASE_PATH=/attendance`, `AUTH_URL=https://loop-runner.<tailnet>.ts.net/attendance/api/auth`, WebAuthn rpID `loop-runner.<tailnet>.ts.net`, origin `https://loop-runner.<tailnet>.ts.net`, SQLite file, app bound to 127.0.0.1 only. At T16, find out which client-IP header Tailscale Serve actually sends (expected `X-Forwarded-For`) with a request through it, and set `TRUSTED_IP_HEADER`/`TRUSTED_PROXY_HOPS=1` to match. TH-25 applies to that mirror (meet shares the origin at `/meet`; both apps are ours). What this choice forces: tailnet clients arrive with 100.64.0.0/10 IPs, which `cidr_not_public` rejects. Add an env-gated `ALLOW_TAILNET_CIDRS=1` (staging only, with its own test) that allows subranges of 100.64.0.0/10; every other private range is still rejected. Still blocked on the holder: enabling Tailscale Serve for the tailnet, and registering the staging Google redirect (D-004).

## D-004 · OD-2 · Google OAuth client and Workspace domain restriction?
- app: attendance | status: OPEN
- context: Blocks T16 (`- [!]`). The secret store already holds `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_SECRET` (only the names were checked, not the values). The client still needs the redirect `https://<staging domain from D-003>/api/auth/callback/google` registered. To check it, run `REDIRECT_URIS=https://<staging>/api/auth/callback/google loop/secrets.sh verify attendance`, which must print `creds_valid=true` and `registered=true`. The domain restriction is enforced server-side by comparing the `hd` claim with `orgs.allowed_google_hd` (spec §2.3 step 2).
- options: A) Any Google account, gated only by the member email allowlist. B) Restrict sign-in to one Workspace domain (`orgs.allowed_google_hd`).
- recommendation: A for the live demo, because attendees use personal Gmail. B for any real customer.
- answer: (holder, 2026-11-17) **Client: done.** The holder uploaded a Google web client; it is checked live (`creds_valid=true`), and the localhost redirect is registered. **Production redirect:** the holder registers `https://attendance.apps.taqat.academy/api/auth/callback/google`. Check it with `REDIRECT_URIS=https://attendance.apps.taqat.academy/api/auth/callback/google loop/secrets.sh verify attendance`. **Domain restriction:** still open, and the spec default A applies: any Google account, gated by the member allowlist.

## D-005 · MEET-1 · Where should the staging deploy run?
- app: meet | status: ANSWERED
- context: Blocks M05 (`- [!]`), the first meet task that needs a human. M01 to M04 run on the local dev server. LiveKit media always runs on LiveKit Cloud, and the host only serves Next.js and mints tokens. Agents workers (V-05/V-06) need a long-running host (see D-019).
- options: A) Netlify, through the Netlify connector already attached to this Claude environment. B) Vercel (needs a human-made `VERCEL_TOKEN`). C) Own VPS with docker compose + Caddy (needs SSH + DNS).
- recommendation: A for now, because it needs no human setup beyond env vars. Move to C only if Agents ventures get approved.
- answer: (holder, 2026-11-17) C, varied: **loop-runner, tailnet only**. Tailscale Serve mounts `/meet` → `http://127.0.0.1:3101/meet`, served at `https://loop-runner.<tailnet>.ts.net/meet` with `BASE_PATH=/meet`; no Caddy and no public DNS. The same box can later host an Agents worker (D-019). Still blocked on the holder enabling Tailscale Serve for the tailnet.

## D-006 · MEET-2 · Which LiveKit Cloud project holds the staging keys?
- app: meet | status: ANSWERED
- context: Blocks M05 (`- [!]`). `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are human-provided. They go in the deploy host env and in the store `~/.config/loop-lab/secrets/meet.env` (dir 700, file 600, written by `loop/secrets.sh add meet`), and never in a commit, the ledger or this file. The store already holds all three names (values not checked), so the question is which project they belong to. `loop/secrets.sh verify meet` must print `status=200` before M05 starts.
- options: A) A new dedicated `loop-lab-staging` Cloud project (replace the stored keys if they come from another project). B) An existing project.
- recommendation: A. Usage stays isolated and the keys can be revoked after the session.
- answer: (holder, 2026-11-17) A. It is the dedicated test project `test-loops` (on LiveKit Cloud). The keys are in `meet.env` and checked live: `loop/secrets.sh verify meet` gives `status=200`. Rotate the secret after the live session.

## D-007 · MEET-3 · What should the staging access policy be?
- app: meet | status: PARKED
- context: Blocks M05 (`- [!]`). With a public `/api/token` route, anyone can mint tokens and spend Cloud minutes. Caps are possible with `at.roomConfig = new RoomConfiguration({ maxParticipants: 8, emptyTimeout: 300 })`. With B, M05 adds U11 (a wrong code returns 401), the loop generates `MEET_ACCESS_CODE` into the store, and the holder shares it. V-04 (guest links) only makes sense with B.
- options: A) Open + caps. B) Shared access code `MEET_ACCESS_CODE` + caps. C) Google login.
- recommendation: B. It is one env var, it is testable (U11), and it needs no OAuth setup.
- answer: _(loop holder writes here)_

## D-008 · OD-9 · Missed check-out policy?
- app: attendance | status: OPEN
- context: Nothing is blocked. The loop touches this at T18 (two tasks after T06), which builds the state rule from the spec: an IN older than the site's `max_shift_hours` (16) counts as OUT, so a forgotten check-out never blocks the next day's IN (AC-07, TH-22). The loop builds A until this is answered, because the spec already says A. B needs a spec change and a new task.
- options: A) Leave it open and flag it in the report; the admin corrects it with a reason. B) Auto-close it at site midnight.
- recommendation: A.
- answer: _(loop holder writes here)_

## D-009 · OD-5 · Data retention periods?
- app: attendance | status: OPEN
- context: Nothing is blocked. T18's migration 0002 adds triggers that allow exactly one change, setting `ip`/`ua` to NULL (AC-28). IP and UA sit outside the hash chain, so purging them does not break verification. Tickets, challenges and rate-limit rows are operational only. No backlog task runs the purge job yet: after answering, the holder adds one (T21+) or asks a non-loop session to add it.
- options: A) Events 24 months; IP+UA nulled after 90 days; tickets/challenges/rate_limits purged after 7 days; audit_log 24 months. B) Other durations for the same four classes, written in the answer.
- recommendation: A.
- answer: _(loop holder writes here)_

## D-010 · OD-6 · External anchoring of the attendance-log head hash?
- app: attendance | status: OPEN
- context: Nothing is blocked. T18 adds `verifyChain(rows, key, {anchor})`, which can only catch a tail cut if an anchor exists outside the DB. The HMAC chain detects DB edits by anyone who lacks `LOG_CHAIN_KEY`. An owner with DB access and the key can still rebuild the chain or cut the newest rows (TH-13), and only an external anchor detects that. B needs a new task (T21+), and no backlog line adds it yet.
- options: A) None. B) Post the daily chain-head hash (events + audit) and every `network.*` / `credential.approve` change to an external channel (Telegram / email / object-lock bucket).
- recommendation: B. It is cheap and makes owner-level rewrites and tail cuts detectable. The Telegram bot from D-002 can carry it.
- answer: _(loop holder writes here)_

## D-011 · OD-3 · Default QR mode for new sites?
- app: attendance | status: OPEN
- context: Nothing is blocked. The loop uses this from T19 (site admin: `qr_mode`, rotation 10–120 s, grace 0–2) and T08 (static QR mint; a TTL over `STATIC_QR_MAX_TTL_DAYS` = 30 returns `ttl_too_long`). A rotating kiosk QR (30 s, grace 1) means a forwarded photo stops working within 60 s. A static printed QR with a TTL is the owner's original idea, but a photo of it works until expiry, and only the IP gate protects it.
- options: A) Rotating kiosk, 30 s, grace 1. B) Static printed QR with an admin-set TTL.
- recommendation: A as the default. Allow B per site with a max TTL of 30 days and a "weaker" warning in the UI.
- answer: _(loop holder writes here)_

## D-012 · OD-4 · Allow synced passkeys (backup-eligible, BE=1)?
- app: attendance | status: OPEN
- context: Nothing is blocked. The loop uses this at T09 (registration; AC-35 tests both settings), and the schema default is `orgs.allow_synced_passkeys = true`. iCloud Keychain and Google Password Manager passkeys sync across the user's devices, so strict device binding is impossible on iOS and Android. Rejecting BE=1 blocks almost every iPhone and Android phone.
- options: A) Allow them and flag "synced" in the approval UI. B) Reject BE=1 credentials (`synced_not_allowed`).
- recommendation: A.
- answer: _(loop holder writes here)_

## D-013 · OD-10 · Four-eyes rule for credential approvals?
- app: attendance | status: OPEN
- context: Nothing is blocked. This one is in spec §9, which the other entries mirror. It relates to T10 (approvals). A colluding admin can approve a ghost employee's phone (TH-20 stays High until this exists). No backlog task implements B or C yet, so either one needs a new task (T21+).
- options: A) None. B) The approver must not be the member's inviter; the owner is exempt. C) B, plus network changes need a second admin.
- recommendation: B once the org has 2 or more admins. Until then TH-20 stays High.
- answer: _(loop holder writes here)_

## D-014 · MEET-4 · Which venture autonomy level should the loop run at?
- app: meet | status: PARKED
- context: Nothing is blocked. ideate reads this at its next run and uses L0 while it is unanswered. L0: the holder approves every venture. L1: the loop auto-approves gated ventures that are effort S, have a `local` oracle and score at least 16/20. L2: the loop auto-approves gated ventures that score at least 14/20, and the holder can veto afterwards (REJECTED reverts the merge).
- options: A) L0. B) L1. C) L2.
- recommendation: A (L0) during the live session, because the approval is the on-stage moment. Change the answer to L1 afterwards.
- answer: _(loop holder writes here)_

## D-015 · MEET-5 · Should ventures whose oracle needs LiveKit Cloud be allowed?
- app: meet | status: PARKED
- context: Nothing is blocked. The answer decides whether ideate's judges and build-next's converter treat `cloud` ventures as buildable. Krisp (V-09), Egress recording (V-08), `room_finished` webhooks (V-07) and possibly `moveParticipant` breakouts (V-11) cannot be proven on the local dev server.
- options: A) Yes, verified on staging with the Cloud keys once M05 is green. B) Local-oracle ventures only.
- recommendation: A. Tag these ventures `oracle: cloud` and add their tasks as `- [!]` until M05 is `[x]`.
- answer: _(loop holder writes here)_

## D-016 · OD-8 · Require an admin passkey step-up for approve, revoke and correct?
- app: attendance | status: OPEN
- context: Nothing is blocked. This matters only after T15. It mitigates admin-session theft and casual admin abuse (TH-11). It is not in the backlog, so B needs a new task (T21+, deps T15).
- options: A) No. B) Yes: the admin confirms with their own passkey (UV) before each sensitive action.
- recommendation: B, added as a v1.1 task after T15.
- answer: _(loop holder writes here)_

## D-017 · OD-7 · Buddy-punch control beyond software?
- app: attendance | status: OPEN
- context: Nothing is blocked. If B hands A an unlocked phone plus the passcode, no web app can tell. The OS passcode also satisfies UV, and the server never sees a fingerprint (TH-03).
- options: A) Accept and document the residual risk. B) Kiosk camera snapshot at punch time. C) Supervisor spot checks.
- recommendation: A for v1, with B as a later venture.
- answer: _(loop holder writes here)_

## D-018 · MEET-6 · When should the third-party keys for AI ventures be provided?
- app: meet | status: PARKED
- context: Nothing is blocked yet. Ventures V-05 to V-08 need human-provided secrets: an STT/LLM key, a Telegram bot token and chat id, and an S3 bucket with keys. They are added with `loop/secrets.sh add meet` and are never written here.
- options: A) Provide them now. B) Provide them only when such a venture is APPROVED; its task stays `- [!]` until then.
- recommendation: B.
- answer: _(loop holder writes here)_

## D-019 · MEET-7 · Where would an Agents worker run, if an Agents venture is approved?
- app: meet | status: PARKED
- context: This only matters if V-05 (live captions) or V-06 (AI notes) is approved. Netlify and Vercel cannot host long-running workers.
- options: A) LiveKit Cloud agent hosting (`lk cloud auth` + `lk agent create`, then `lk agent deploy`). B) Own VPS.
- recommendation: A, so there is no box to look after.
- answer: _(loop holder writes here)_

## D-020 · T18 changed 2 assertions of an existing AC-28 test: accept?
- app: attendance | status: OPEN
- context: the T18 backlog line says "existing tests untouched", but revised AC-28 inverts one existing assertion. `tests/unit/db-append-only.test.ts` asserted that `UPDATE attendance_events SET ip = NULL` aborts and that exactly 4 triggers exist. Revised AC-28 requires `SET ip=NULL, ua=NULL` to succeed (retention), which needs 2 new triggers. T18 changed only those 2 lines: `SET ip = NULL` → `SET ip = '203.0.113.9'` (still must abort, per the revised AC), and the trigger list now names 6 triggers. Every other assertion is unchanged, and the new `db-retention.test.ts` covers the revised rule. Also noted: §2.2 lists `cidr_too_broad` before `cidr_not_public`, but AC-03 expects `10.0.0.0/8` → `cidr_not_public` and `/0` → `cidr_too_broad`. `parseCidr()` therefore classifies a block that lies entirely inside one non-public range as `cidr_not_public` first, then applies the prefix rule.
- options: A) accept both as done. B) revert the 2 assertions and change AC-28 back (the spec edit is the holder's).
- recommendation: A. The old assertions test the pre-revision AC. Keeping them would make the revised AC impossible to satisfy.
- answer: _(loop holder writes here)_

## D-021 · §7.1 helper: a UV=0 registration needs an authenticator without UV. Accept the helper change?
- app: attendance | status: OPEN
- context: spec §7.1 says that `addAuthenticator(page, {uv:false})` (hasUserVerification:true, isUserVerified:false) plus a client-side `userVerification:'discouraged'` override makes the authenticator sign with UV=0. Measured on Playwright 1.65's Chromium 159 (headless shell): such an authenticator refuses **every** `navigator.credentials.create`, including `discouraged`, with `NotAllowedError`. Only an authenticator **without** UV (`hasUserVerification:false`) signs with UV=0 (flags `01000001`). T09 therefore sets `hasUserVerification: opts.uv ?? true` in `e2e/helpers/webauthn.ts`, and the AC-18 override also relaxes `residentKey` on the client. The server's options and checks are unchanged, and it answers `uv_required` from the signed UV flag (AC-18 is green).
- options: A) accept: the helper models "a phone that signs without UV" this way. B) the holder rewords §7.1 to describe the helper exactly as built.
- recommendation: A, and let B follow at the next spec edit. The AC is unchanged; only the stand-in's knobs differ from the snippet.
- answer: _(loop holder writes here)_

## D-022 · OD-1 · Staging port: 3100 collides with the E2E oracle and meet. Move staging to 3101?
- app: attendance | status: ANSWERED
- context: D-003's answer mounts Tailscale Serve `/attendance` → `http://127.0.0.1:3100/attendance`. On loop-runner, port 3100 is also the attendance E2E dev server (spec §6.3, `playwright.config.ts`, `reuseExistingServer:false`) and meet's `dev`/`start` (specs/meet.md §6). A staging server on 3100 makes `npm run e2e` fail with "port already used" for the whole time staging runs, so every later loop iteration on this box goes red. Everything else in D-003 stands. T16 still waits on enabling Serve (`tailscale serve status` said "No serve config" on 2026-11-17) and on D-004 (staging Google redirect).
- options: A) staging on `127.0.0.1:3101`, Serve `/attendance` → `http://127.0.0.1:3101/attendance`. B) keep staging on 3100 and run the oracle here with `E2E_PORT=3110` (the config already supports it). C) keep 3100 and stop staging whenever the loop runs E2E.
- recommendation: A. The oracle and meet keep the spec's ports and nothing has to be stopped.
- answer: (holder, 2026-11-17) Moot: D-003 now deploys to apps-host, not loop-runner. Port 3100 on loop-runner stays the E2E oracle's.

## D-023 · STEER · The build loop converged. Drift it into a production loop?
- app: attendance | status: ANSWERED
- context: Raised by the loop holder live, at the end of the workshop, as the session's last decision. The build loop merged 19 of 20 tasks unattended (11:53–13:32 UTC), and its only remaining task, T16, was a deploy. A build loop's oracle stops at "tests are green". The lecture's fourth and fifth stations, "Deploy · verify the running version" and "behavior checked after release", need a different loop, whose oracle is the running production system.
- options: A) Keep the build loop and deploy by hand. B) Steer: the holder drifts the loop into a production loop (spec `specs/prod-loop.md`, backlog `loop/backlog-prod.md`). It auto-deploys every green `main` to `https://attendance.apps.taqat.academy`, observes production, rolls back on a red smoke, escalates anomalies here, and accepts trainee contributions through agent PRs.
- recommendation: B. The decision is the lecture's point: a human steers the loop and does not sit in it.
- answer: (holder, 2026-11-17, live) **B.** This is the last decision of the workshop. The steering drifts the loop into a different loop, and production observation building has started. Spec: `specs/prod-loop.md`. Backlog: `loop/backlog-prod.md`. It is dispatched to its own session and auto-deploys to apps.taqat.academy. The repo goes public for the trainees, with the full history of every human interaction (`docs/history/`).

## D-024 · PROD-1 · How do trainees' agent PRs reach main?
- app: attendance | status: ANSWERED
- context: The repo is public and is meant for agentic contributions from trainees. Every merge to `main` auto-deploys to production (D-023), so a merge is a production decision.
- options: A) The holder approves: each PR needs the CI oracle green **and** the holder's review. B) Auto-merge on green: any PR that passes the CI oracle merges and deploys unreviewed.
- recommendation: A. A public repo plus auto-deploy means anyone's PR would reach production without a human; the oracle cannot judge intent.
- answer: (holder, 2026-11-17, picked "Holder approves (Recommended)") **A.** `main` will require the CI `oracle` check and a CODEOWNER (holder) review for PRs, with force-push off. Task P05 sets this up once the repo is public. The repo owner's own loop commits are not blocked (enforce_admins off). Trainees fork and open PRs.

