# Backlog: meet

Spec: `specs/meet.md` (AC ids `MEET-AC-xx`, unit cases `U1-U10`, decisions `MEET-1..7`).
Run every `done when` from the repo root. The local oracle is the LiveKit dev server (`npm --prefix apps/meet run lk:up`, pinned `livekit/livekit-server:v1.13.11`, keys devkey/secret). No task before M05 needs a human or a Cloud key.
`- [ ]` open · `- [x]` done · `- [!]` blocked (see `loop/decisions.md`, `app: meet`). Pick the first open task whose deps are all `[x]`.

## v0

- [ ] M01 · Scaffold apps/meet: Next.js + Vitest + Playwright + smoke test + dev-server scripts — deps: none — done when: `npm --prefix apps/meet run typecheck && npm --prefix apps/meet test && npm --prefix apps/meet run e2e -- smoke && npm --prefix apps/meet run lk:up`
  Exact scaffold command + gotchas table + npm scripts from spec §1 (`--no-cache-components`, `reactStrictMode: false`, vitest `@` alias, `!.env.example` in `apps/meet/.gitignore`); run `npm --prefix apps/meet run e2e:install` once.
  Add `/api/health` (MEET-AC-06, `await connection()`) + a placeholder `/` with an `<h1>`; `tests/e2e/smoke.spec.ts`: health returns 200 `ok:true`, `/` renders the h1; 1 trivial vitest so `test` is non-empty.
  Create `scripts/lk-up.sh` (pinned tag, `--node-ip 127.0.0.1`), `lk-down.sh`, `check-no-secret.sh` exactly per spec §2, and wire `verify` (it may fail until M04). `lk:up` is in the done-when so a missing Docker fails here, not at M03.

- [ ] M02 · Token route POST /api/token + unit tests — deps: M01 — done when: `npm --prefix apps/meet run typecheck && npm --prefix apps/meet test -- token && npm --prefix apps/meet run check:no-secret`
  MEET-AC-02, MEET-AC-07, U1-U10. Keep `src/lib/token.ts` (`mintToken`) and `src/lib/validate.ts` pure; the route stays thin (`runtime = 'nodejs'`, `Response.json`, `Cache-Control: no-store`); tests call the exported `POST` directly.
  Verify claims with `await new TokenVerifier(key, secret).verify(jwt)`. The grant is `roomJoin, room, canPublish, canSubscribe, canPublishData` only. Identity is server-generated, empty slug becomes `user` (U4 Arabic case).

- [ ] M03 · Join page + room UI (VideoConference, mic/cam toggle, leave) — deps: M02 — done when: `npm --prefix apps/meet run typecheck && npm --prefix apps/meet run lk:up && npm --prefix apps/meet run e2e -- join`
  MEET-AC-01, 03, 04, 05. `/r/[room]` is a client component (`useParams`, sessionStorage read in `useEffect`): `LiveKitRoom` + `VideoConference` + `@livekit/components-styles` + testids `room-name`, `participant-count`.
  `join.spec.ts`: alone gives count `1`; `.lk-control-bar button[data-lk-source=microphone|camera]` flips `data-lk-enabled`; `.lk-disconnect-button` lands on `/`; `/r/e2e-nosession` with no session lands on `/?room=e2e-nosession`.

- [ ] M04 · Two-participant E2E against the local LiveKit dev server — deps: M03 — done when: `npm --prefix apps/meet run lk:up && npm --prefix apps/meet run e2e -- two-party --repeat-each=3 && npm --prefix apps/meet run verify`
  Two browser contexts, both counts reach `2`; `RoomServiceClient.listParticipants(room)` returns exactly the 2 identities from `/api/token`, each with ≥1 track (poll ≤15 s); A leaves, then B shows `1` and the server shows 1.
  `verify` is now the v0 exit gate and must stay green for every later task. 3 green repeats in a row = not flaky; any red repeat is a `test_fail`, never a retry-until-green.

- [!] M05 · Staging deploy (LiveKit Cloud keys) + staging two-party check — deps: M04 — done when: `set -a && . ~/.config/loop-lab/secrets/meet.env && set +a && curl -fsS "$MEET_STAGING_URL/api/health" | grep -q '"livekit":true' && E2E_BASE_URL="$MEET_STAGING_URL" npm --prefix apps/meet run e2e -- two-party`
  BLOCKED on MEET-1 (deploy target), MEET-2 (Cloud project + keys via `loop/secrets.sh add meet`, then `loop/secrets.sh verify meet` must print `status=200`) and MEET-3 (access policy).
  Deploy, then `echo MEET_STAGING_URL=https://... | loop/secrets.sh add meet`; log `deployed` with URL + sha (never a key); on failure redeploy the last green sha. If MEET-3 = B: token route checks `MEET_ACCESS_CODE`, add U11 (wrong code → 401), e2e fills the code from env.

## Venture tasks (appended by build-next from APPROVED decisions; ids continue at M06)

_(none yet: approve a venture in `loop/decisions.md` and the next build-next run lands its tasks here)_
