# meet: spec

> **Loop type: venture (open) loop.** v0 is deliberately tiny and fully machine-verified. Every feature after v0 enters
> through `loop/ventures.md` -> `loop/decisions.md` -> `loop/backlog-meet.md`. The loop holder approves ventures and
> does nothing else.
> Code lives in `apps/meet/` and is created by the loop (M01), not by hand.
> API names below were checked on 2026-11-17 against the npm tarballs (livekit-server-sdk 2.20.0, @livekit/components-react 2.9.25,
> livekit-client 2.24.1, @livekit/track-processors 0.8.3, create-next-app 16.4.6) and the livekit-server v1.13.11 source.

---

## 1. v0 scope (tiny on purpose)

### Stack

| Piece | Package | Version checked |
|---|---|---|
| App (App Router, TS, `src/`) | `next` | 16.4.6 |
| Token minting + server API | `livekit-server-sdk` | 2.20.0 |
| Room UI (prebuilt) | `@livekit/components-react` | 2.9.25 |
| Room UI styles | `@livekit/components-styles` | 1.2.0 |
| Client SDK (peer dep of components) | `livekit-client` | 2.24.1 |
| Unit tests | `vitest` | 5.x |
| E2E | `@playwright/test` (Chromium only) | 1.65.x |
| Local media server (oracle) | Docker image `livekit/livekit-server:v1.13.11` (**pinned**) | v1.13.11 = latest release |

Node 22.12+ is required (vitest 5 engines); the runner has 22.23.

Scaffold command (flags checked against create-next-app 16.4.6):
`npx create-next-app@16.4.6 apps/meet --ts --app --src-dir --eslint --no-tailwind --no-cache-components --no-react-compiler --use-npm --disable-git --no-agent-feedback --yes`
then `npm --prefix apps/meet i livekit-server-sdk @livekit/components-react @livekit/components-styles livekit-client`
and `npm --prefix apps/meet i -D vitest @playwright/test`.

| Scaffold gotcha | Why it matters |
|---|---|
| `--no-cache-components` | create-next-app 16.4.6 **defaults `cacheComponents: true`**, which can prerender GET handlers such as `/api/health` at build time and rejects some segment configs |
| `--yes` reads saved prefs | `~/.config/create-next-app-nodejs/config.json` fills any flag left out, so every flag that matters is passed explicitly |
| `apps/meet/AGENTS.md` | Written by default (Next.js agent rules). Keep it: it points agents at the bundled Next 16 docs |
| `next.config.ts`: `reactStrictMode: false` | StrictMode double-mounts `LiveKitRoom` in `next dev` (connect, disconnect, reconnect), which can fire `onDisconnected` and bounce a live demo back to `/`. Tests run the production build either way |
| `vitest.config.ts`: `resolve.alias { '@': fileURLToPath(new URL('./src', import.meta.url)) }` | Vitest does not read tsconfig `paths` on its own |

### Features (v0 = exactly these, nothing more)

| AC id | Feature | Acceptance (what the tests check) |
|---|---|---|
| MEET-AC-01 | Join page `/` | Keeps the M01 `<h1>` (the smoke test asserts it). Form with room name and display name. Client-side validation uses the same rules as the API (shared `src/lib/validate.ts`, which must not import `livekit-server-sdk`). Submit POSTs `/api/token`, stores `{token,url,identity}` in `sessionStorage["meet:<room>"]` and navigates to `/r/<room>`. `/?room=x` prefills the room. Invalid input shows an inline error and makes **no** network call. |
| MEET-AC-02 | Token route `POST /api/token` | Follows the contract below exactly. |
| MEET-AC-03 | Room view `/r/[room]` | Client component (`'use client'`; reads the room with `useParams()`, because Next 15+ page `params` are async). Reads `sessionStorage` inside `useEffect` (the page is still server-rendered once, where `sessionStorage` does not exist). Renders `<LiveKitRoom serverUrl token connect video audio onDisconnected>` wrapping `<VideoConference />` inside `<div data-lk-theme="default" style={{height:'100dvh'}}>`. Imports `@livekit/components-styles`. Header shows `data-testid="room-name"` and `data-testid="participant-count"` (`useParticipants().length`, which includes the local participant). No session entry means a redirect to `/?room=<room>`; an invalid room slug redirects to `/`. |
| MEET-AC-04 | Mic/cam toggle | Uses the ControlBar that `VideoConference` already ships. Select **`.lk-control-bar button[data-lk-source="microphone"]`** / `...="camera"]`: tiles and `<video>` elements also carry `data-lk-source`, so a bare attribute selector trips Playwright strict mode. The buttons flip `data-lk-enabled` / `aria-pressed`. |
| MEET-AC-05 | Leave | The prefab Leave button (`.lk-disconnect-button`) disconnects. Under 760 px wide (1000 px with chat open) the ControlBar goes icon-only and loses its "Leave" text, so tests select by class, not by name. `onDisconnected` clears `sessionStorage["meet:<room>"]` and calls `router.replace('/')`. |
| MEET-AC-06 | Health `GET /api/health` | `{"ok":true,"livekit":<true if all 3 LIVEKIT_* vars are set>}`. The handler calls `await connection()` (from `next/server`) so it is evaluated per request and never prerendered at build time. It never echoes any value. |
| MEET-AC-07 | Secret never reaches the client | No `NEXT_PUBLIC_LIVEKIT_*` vars. No `'use client'` file (and not `src/lib/validate.ts`) imports `livekit-server-sdk`. A canary secret is absent from `.next/static` and from prerendered `.next/server/app` output. |

Comes free with the `VideoConference` prefab: basic **non-persistent** chat (text streams, topic `lk.chat`), screen share, focus/grid layout,
device menus, and per-tile connection-quality bars (`data-lk-quality`), mute icons and the speaking highlight.
v0 tests do not cover them, and ventures must not re-propose them as they are.

**Non-goals for v0:** accounts and auth, host roles, recording, any DB or persistence, custom layouts, TURN config, mobile apps, rate limiting (see decision MEET-3).

### Token route contract: `src/app/api/token/route.ts`

The route declares `export const runtime = 'nodejs'`. The route itself is thin: it calls the pure `mintToken(input, env)` in `src/lib/token.ts`, which the unit tests target.
It answers with the Web `Response.json(...)` (not `NextResponse`) so Vitest can import `POST` from `route.ts` and call
`POST(new Request('http://t/api/token', { method: 'POST', body }))` directly for U6-U10, with no Next server running.

Request: `POST` with a JSON body `{ "room": string, "name": string }`

| Rule | Value |
|---|---|
| `room` | `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$` (3-40 chars, lowercase slug) |
| `name` | trimmed, 1-40 chars, no control chars (`/^[^\p{Cc}]{1,40}$/u`) |
| body | a JSON object of at most 1 KB; anything else returns 400 |
| identity | **server-generated**: `<slug(name)>-<8 random hex>`. `slug` = NFKD, lowercase, every run of non-`[a-z0-9]` becomes `-`, trim `-`, cut to 24 chars, and **empty becomes `user`** (Arabic or emoji names slug to nothing). It is never taken from the client, which also avoids duplicate-identity kicks |
| `name` claim | the display name (`new AccessToken(key, secret, { identity, name, ttl })`) |
| grant | `at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true })`. Nothing else: no `roomAdmin`, `roomCreate`, `roomList` or `roomRecord` |
| ttl | `MEET_TOKEN_TTL_SECONDS`, default `600`. This is the join window; LiveKit refreshes tokens for clients that are connected |
| signing | `await at.toJwt()` (async in server-sdk v2) |

| Case | Status | Body |
|---|---|---|
| ok | 200 | `{ "token": "<jwt>", "url": "<LIVEKIT_URL>", "identity": "...", "room": "..." }` |
| bad room / name / body | 400 | `{ "error": "invalid_room" \| "invalid_name" \| "invalid_body" }` |
| env missing | 500 | `{ "error": "server_misconfigured" }` (no var names, no values) |
| GET/PUT/... | 405 | Next default for methods that are not exported |

Every response sets `Cache-Control: no-store`. Logs may contain `{room, identity}` only, never the token or the secret.

### Env

| Var | Scope | Local test value | Notes |
|---|---|---|---|
| `LIVEKIT_URL` | server only | `ws://localhost:7880` | Returned to the browser by `/api/token`, so no `NEXT_PUBLIC_` var is needed |
| `LIVEKIT_API_KEY` | server only | `devkey` | |
| `LIVEKIT_API_SECRET` | server only | `secret` | The Cloud value is a human-provided secret (section 4). `devkey`/`secret` are the dev server's built-in keys (livekit-server `main.go`, dev mode) |
| `MEET_TOKEN_TTL_SECONDS` | server, optional | `600` | |

`apps/meet/.env.example` lists the names only. The scaffold's `apps/meet/.gitignore` ignores `.env*`, which would also hide
`.env.example`, so M01 appends `!.env.example` there. `loop/secrets.sh link meet` symlinks the real store to `apps/meet/.env.local`;
explicit env (Playwright `webServer.env`, `check-no-secret.sh`) always wins over `.env.local`, so tests never pick up Cloud keys by accident.

### Layout and npm scripts (contract; M01 creates the scripts and later tasks fill them in)

```
apps/meet/
  src/app/page.tsx               join form            src/lib/validate.ts   shared rules
  src/app/r/[room]/page.tsx      room view (client)   src/lib/token.ts      mintToken()
  src/app/api/token/route.ts     src/app/api/health/route.ts
  tests/unit/*.test.ts           tests/e2e/*.spec.ts  (venture tests: v-XX-*.test.ts / v-XX-*.spec.ts)
  scripts/lk-up.sh  scripts/lk-down.sh  scripts/check-no-secret.sh
  playwright.config.ts  vitest.config.ts  next.config.ts  .env.example  AGENTS.md (from the scaffold)
```

| Script | Command |
|---|---|
| `dev` / `build` / `start` | `next dev -p 3100` / `next build` / `next start -p 3100` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `e2e` | `playwright test` |
| `e2e:install` | `playwright install --with-deps chromium` (apt deps need sudo; loop-runner has passwordless sudo) |
| `lk:up` / `lk:down` | `bash scripts/lk-up.sh` / `bash scripts/lk-down.sh` |
| `check:no-secret` | `bash scripts/check-no-secret.sh` |
| `verify` | `npm run typecheck && npm test && npm run check:no-secret && npm run lk:up && npm run e2e` (**the single green gate**) |

---

## 2. Automated test oracle (no human ever looks at a video tile)

Every AC id maps to a command that exits 0 or 1. Local tests use the LiveKit **dev server**. Cloud keys are used **only** by the deploy check (M05).

| Layer | Tool | Proves | Needs | Command (from repo root) |
|---|---|---|---|---|
| Unit | Vitest | grants, ttl, identity, validation, route status codes | nothing | `npm --prefix apps/meet test` |
| Leak | build + grep | secret not in the client bundle; no server SDK in client files | nothing | `npm --prefix apps/meet run check:no-secret` |
| Smoke E2E | Playwright | app boots, `/api/health` ok, join form renders | nothing | `npm --prefix apps/meet run e2e -- smoke` |
| Join E2E | Playwright + dev server | one user joins, toggles mic and cam, leaves | local LK | `npm --prefix apps/meet run e2e -- join` |
| Two-party E2E | 2 Playwright contexts + `RoomServiceClient` | both browsers see 2 participants, the server agrees, and leave drops the count to 1 | local LK | `npm --prefix apps/meet run e2e -- two-party --repeat-each=3` |
| Staging | curl + the same two-party spec | the deployed build works against LiveKit Cloud | Cloud keys | see M05 |

### Unit cases: `tests/unit/token.test.ts`

Decode the JWT with `await new TokenVerifier(key, secret).verify(jwt)` from `livekit-server-sdk`, which checks signature, issuer and `exp`
and returns the raw payload (`sub`, `iss`, `nbf`, `exp`, `name`, `video`). In 2.20.0 `toJwt()` sets `nbf` to now and has no `iat`, so U3 uses `exp - nbf`.

| # | Case | Expect |
|---|---|---|
| U1 | valid input | `video.roomJoin === true`, `video.room === room`, `canPublish`/`canSubscribe`/`canPublishData` true |
| U2 | least privilege | `roomAdmin`, `roomCreate`, `roomList`, `roomRecord`, `ingressAdmin` all undefined |
| U3 | ttl | `exp - nbf === 600` (±2 s); the `MEET_TOKEN_TTL_SECONDS` override is honored |
| U4 | identity | `sub` matches `^[a-z0-9-]+-[0-9a-f]{8}$`; two calls with the same name give different `sub`; `name` claim = display name; name `"أحمد"` gives `sub` matching `^user-[0-9a-f]{8}$` and `name === "أحمد"` |
| U5 | issuer | `iss === LIVEKIT_API_KEY` |
| U6 | invalid room | `""`, `"A B"`, `"../x"`, `"-ab"`, 41 chars all give 400 `invalid_room` |
| U7 | invalid name | `""`, `"   "`, 41 chars, `"a\u0000b"` all give 400 `invalid_name` |
| U8 | bad body | non-JSON, an array, more than 1 KB all give 400 `invalid_body` |
| U9 | env missing | 500 `server_misconfigured`; the body contains no env names or values |
| U10 | no secret leak | serialized body + headers do not contain the secret string |

### Local LiveKit dev server: `scripts/lk-up.sh` (idempotent)

| Step | Command |
|---|---|
| already up? | `curl -sf http://localhost:7880` returns 200 `OK`, so exit 0 |
| Linux (runner) | `docker run -d --rm --name loop-lab-lk --network host livekit/livekit-server:v1.13.11 --dev --node-ip 127.0.0.1` |
| macOS / Docker Desktop | `docker run -d --rm --name loop-lab-lk -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server:v1.13.11 --dev --bind 0.0.0.0 --node-ip 127.0.0.1` |
| no Docker | `livekit-server --dev --node-ip 127.0.0.1` (binary) |
| wait | poll `curl -sf http://localhost:7880` for up to 30 s, otherwise exit 1. It answers 406 `Not Ready` for the first seconds, which `-f` treats as not up |
| down | `docker rm -f loop-lab-lk` |

- Dev mode with no keys configured uses `devkey` / `secret` and binds to `127.0.0.1` + `::1` only (livekit-server `cmd/server/main.go`). Ports: 7880 HTTP/WS, 7881 TCP fallback, 7882/udp media.
- `--node-ip 127.0.0.1` makes the ICE candidates loopback, so the result does not depend on which LAN IP the box picks.
- The image tag is **pinned** (v1.13.11, latest release on 2026-11-17) so upstream drift cannot flip the oracle. Bumping it is a decision, not a drive-by edit.
- The OSS server implements `RoomService.MoveParticipant` / `ForwardParticipant` (`pkg/service/roomservice.go`), so V-11 can be proven locally. Egress (V-08) and Krisp (V-09) cannot.

### `scripts/check-no-secret.sh`

Runs with `set -euo pipefail` from `apps/meet` (npm sets the cwd).

1. `CANARY=lk_canary_$(openssl rand -hex 8)`, then run `LIVEKIT_API_SECRET=$CANARY LIVEKIT_API_KEY=k LIVEKIT_URL=ws://x npx next build`
2. `! grep -rqF "$CANARY" .next/static` and `! grep -rqF --include='*.html' --include='*.rsc' --include='*.body' "$CANARY" .next/server/app` (prerendered output is served to browsers too)
3. `CLIENT=$(grep -rlE "^['\"]use client['\"]" src || true); [ -z "$CLIENT" ] || ! grep -l "livekit-server-sdk" $CLIENT`
   (a plain `! grep ... | xargs -r grep` **fails when there are no client files yet**, because `xargs -r` exits 0 on empty input; M02 hits exactly that case)
4. `! grep -q "livekit-server-sdk" src/lib/validate.ts` (shared with the client join form)
5. `! grep -rq "NEXT_PUBLIC_LIVEKIT" src`

### Playwright config essentials: `apps/meet/playwright.config.ts`

```ts
use: {
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
  permissions: ['camera', 'microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  trace: 'retain-on-failure', video: 'retain-on-failure',
},
projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
webServer: process.env.E2E_BASE_URL ? undefined : {
  command: 'npm run build && npm run start',
  url: 'http://localhost:3100/api/health',
  reuseExistingServer: false, // a reused server may be a stale build or a `next dev` with Cloud keys: a false green
  env: { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' },
},
```

Every test uses a unique room (`e2e-<random>`), so tests can run in parallel against one dev server.
`browser.newContext()` inside a test inherits this `use` block (baseURL, permissions) in Playwright 1.65, so the two-party contexts need no extra options.

### Two-party spec: `tests/e2e/two-party.spec.ts` (the core oracle)

| Step | Assertion |
|---|---|
| 1 | `ctxA = browser.newContext()`, `ctxB = browser.newContext()`, then both join room `e2e-<rand>` as `alice` and `bob` through the real join form |
| 2 | Capture each `identity` from `page.waitForResponse('**/api/token')` |
| 3 | Both pages: `getByTestId('participant-count')` has text `2` (timeout 20 s); both pages show 2 `.lk-participant-tile` |
| 4 | Server truth: `new RoomServiceClient(LIVEKIT_URL, KEY, SECRET).listParticipants(room)` (the client maps `ws://` to `http://` itself) returns length 2; the identity set equals the step 2 set; poll up to 15 s until each participant has `tracks.length >= 1` (publishing is async) |
| 5 | A clicks `.lk-disconnect-button`, then A's URL is `/` |
| 6 | B's count reaches `1` within 15 s; poll `listParticipants` until it returns length 1 within 15 s |
| flake gate | `--repeat-each=3` in the done-when command |

In staging mode (`E2E_BASE_URL` set), the spec reads the Cloud `LIVEKIT_*` from env for step 4 and **fails loudly** if they are missing. It never skips silently.

The join spec covers one user: count `1`, `data-lk-enabled` on `.lk-control-bar button[data-lk-source=microphone|camera]` flips true to false to true,
Leave lands on `/`, and opening `/r/e2e-nosession` directly with no session lands on `/?room=e2e-nosession` with the room prefilled
(the room must be a valid slug: `x` is only 1 char and would be rejected by the room rule).

---

## 3. The venture loop (how meet grows with no human in the build path)

```
ideate.js ──> 4 lens proposers ──> 3-judge panel ──> top 3 ──> loop/decisions.md  (status: OPEN)
   ^                                                                 │
   │                                                    loop holder sets APPROVED / REJECTED / PARKED
   │                                                                 v
   └── ledger "deployed" <── deploy loop <── inner loop <── build-next.js converts APPROVED -> M-tasks
        (next ideate run       (staging)    (build, test,     (backlog-meet.md, "Venture tasks")
         sees the new state)                review, fix)
```

### Ideate run rules (`.claude/workflows/ideate.js`)

| Rule | Value |
|---|---|
| Runs when | `backlog-meet.md` has 0 open `- [ ]` tasks, **or** the loop holder starts it |
| Skips when | 3 or more `app: meet` **venture** decisions (the title names a V-id) are OPEN. Setup questions MEET-1..7 do not count. This WIP cap exists because the holder is the bottleneck by design |
| Reads | this spec, `loop/ventures.md`, the current `apps/meet` code, the last 50 ledger lines with `app=meet` |
| Writes | `loop/ventures.md` (new rows, statuses, scoring log), `loop/decisions.md` (OPEN entries), ledger `decision_needed` (`loop: venture`) |
| Never | writes app code, edits the backlog, or approves anything |

### Four lenses (one proposer agent each; 2-3 candidates per lens)

| Lens | The proposer asks | Typical output |
|---|---|---|
| **U** user value | "What does a 3-10 person team miss most after a week of daily standups?" | hand raise, chat history, pre-join check |
| **D** differentiator | "What makes this more than another Meet clone?" | AI notes delivered to Telegram, live captions |
| **C** cheapest on LiveKit | "What can ship in 1 task using only the primitives we already install (attributes, data packets, text streams, RPC)?" | reactions, hand raise |
| **W** wow-demo | "What makes a live audience react within 30 s on a projector?" | laser pointer on screen share, live poll |

Each candidate must use the `loop/ventures.md` row shape: title, pitch, **named LiveKit primitive**, effort, oracle class, and the
**oracle assertion** (what the test clicks and what it expects, with a timeout). A re-pitch of an existing pool row counts as one more vote for that row; it does not become a duplicate.

Client API placement in livekit-client 2.24 (proposers get this wrong most often):

| Call | Lives on | Needs in the token grant |
|---|---|---|
| `registerRpcMethod`, `registerTextStreamHandler` | `room` (`localParticipant.registerRpcMethod` is deprecated) | `canPublishData` for replies |
| `performRpc`, `sendText`, `streamText`, `publishData` | `room.localParticipant` | `canPublishData` (granted in v0) |
| `setAttributes`, `setMetadata`, `setName` | `room.localParticipant` | **`canUpdateOwnMetadata`** (not granted in v0) |
| RPC payloads | request and response each at most 15 KiB (`MAX_V1_PAYLOAD_BYTES`) | n/a |

### Gates (checked before scoring; a candidate that fails stays `pool` with the reason)

- [ ] Names a real LiveKit API/primitive that exists in the installed package types.
- [ ] Has an automatable oracle: `local`, `cloud` or `+key`. "A human looks at it" is not an oracle.
- [ ] Does not duplicate a prefab feature (chat, screen share, layouts, device menu, connection-quality bars) as it is.
- [ ] If it needs a new human-provided secret, the decision text says so explicitly.
- [ ] If it widens the token grant (MEET-AC-02, U1/U2) or needs a host role (V-17), the decision text says so explicitly.
- [ ] If it adds an npm dependency or a long-running process (Agents worker), the decision text says so explicitly.

### Judge panel and scoring rubric

There are 3 independent judges (product, engineer, demo host). Each scores every gated candidate without seeing the others' scores.
The final score is the **median per criterion**, and the total is their sum (maximum 20).

| Criterion (1-5) | 1 | 3 | 5 |
|---|---|---|---|
| **Value** (small team) | nice-to-have, rarely used | used weekly | used in every meeting |
| **Effort** (inverse) | L: more than 3 tasks, new infra or secrets | M: 2-3 tasks | S: 1 task, existing deps |
| **Risk** (inverse) | cloud-only oracle + 3rd-party secret, or flaky media | 1 assertion needs Cloud | fully provable on the local dev server |
| **Demo-ability** | invisible to the audience | visible but needs explaining | obvious on a projector within 30 s |

Selection: the top 3 by total are queued. Ties go to the higher Effort score (cheaper first), then the higher Risk score. A total below 12 is never queued.

### Decision entry produced for a venture (example)

```
## D-0xx · Build V-02 Emoji reactions?
- app: meet | status: OPEN
- context: score 17/20 (value 3, effort 5, risk 5, demo 4); primitive: lossy data packets, topic "reactions"; oracle: local two-party E2E
- options: A) APPROVED, build now  B) PARKED, keep in pool  C) REJECTED, drop
- recommendation: A. One task, no new deps, strong stage moment.
- answer: _(loop holder writes here)_
```

The holder edits only `status:` and `answer:`. The answer can add constraints ("approve, but no new npm deps"), and build-next copies them into the task notes.

### Conversion (the first step of every `build-next.js` run)

| Decision status | `ventures.md` status | Backlog effect | Ledger |
|---|---|---|---|
| APPROVED | `approved`, then `built` when all its tasks are ticked | append 1-3 tasks `M<next>` under "Venture tasks", with deps and a done-when that targets `tests/e2e/v-XX-*.spec.ts` / `tests/unit/v-XX-*.test.ts` | `decision_answered`, then the normal `start` ... `merged` events |
| REJECTED | `rejected` | none | `decision_answered` |
| PARKED | `pool`, with a cooldown of 3 ideate runs | none | `decision_answered` |

Every venture task must also keep `npm --prefix apps/meet run verify` green, so there are no regressions. After merge, the deploy loop ships to staging automatically once MEET-1..3 are answered, and logs `deployed` with the URL and sha.

### Autonomy dial (how little human is needed; see decision MEET-4)

| Level | Human does | Loop does alone |
|---|---|---|
| L0: live demo | approves every venture on stage | everything else |
| L1 | approves only M/L ventures or ventures that need a new secret | auto-approves gated ventures with effort S, `local` oracle and total ≥ 16 |
| L2 | reviews the ledger weekly and can veto after the fact (REJECTED reverts the merge) | auto-approves every gated venture with total ≥ 14 |

---

## 4. Deploy

LiveKit media always runs on **LiveKit Cloud** (a staging project). The app host only serves Next.js and mints tokens.

| Option | How an agent deploys with no human | Pros | Cons |
|---|---|---|---|
| A. Netlify | a Netlify connector is already attached to this Claude environment: create the site, set env, deploy `apps/meet` | zero infra, Next route handlers supported, a preview URL per deploy | cannot host long-running Agents workers (V-05/V-06) |
| B. Vercel | `vercel deploy --prod --token $VERCEL_TOKEN` | first-class Next.js | needs a human-made token; same Agents limitation |
| C. Own box (existing VPS) | `docker compose up -d` (Next `output: 'standalone'`) behind Caddy TLS | full control; can also run the Agents worker and receive webhooks | the agent needs SSH and DNS; we own TLS and uptime |

### Human-provided secrets (never committed, never written to the ledger)

| Secret | Provided by | Stored in |
|---|---|---|
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (Cloud staging project) | loop holder creates the project and an API key in the LiveKit Cloud dashboard, then pipes them into `loop/secrets.sh add meet` | deploy host env + the store `~/.config/loop-lab/secrets/meet.env` (dir 700, file 600; see `loop/secrets.sh`) |
| Deploy credential (Netlify/Vercel token or SSH key) | loop holder | same store |
| `MEET_ACCESS_CODE` (only if MEET-3 = B) | the loop generates it; the holder shares it | deploy host env + store |
| `MEET_STAGING_URL` (not a secret) | the deploy loop, after the first deploy: `echo MEET_STAGING_URL=https://... \| loop/secrets.sh add meet` | store |

Before M05 starts, the loop runs `loop/secrets.sh verify meet` (a live `ListRooms` call against Cloud). Non-200 means the task stays `- [!]` and a decision is queued.

### Deploy oracle (the M05 done-when)

The deploy passes when `/api/health` reports `"livekit":true` and the two-party spec passes against `E2E_BASE_URL=$MEET_STAGING_URL` using the Cloud keys.
The done-when loads the store first (`set -a && . ~/.config/loop-lab/secrets/meet.env && set +a && ...`) so it runs the same from any fresh shell.
On failure the loop redeploys the previous green commit and logs `test_fail` + `blocked`, then queues a decision. Nobody gets paged.

---

## 5. Open decisions (to be queued in `loop/decisions.md` with `app: meet`)

| # | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| MEET-1 | Staging deploy target? | A) Netlify B) Vercel C) own VPS | **A** now (the connector is already wired, so no human setup); move to C only if Agents ventures are approved | M05 |
| MEET-2 | Which LiveKit Cloud project holds the staging keys? | A) new dedicated `loop-lab-staging` project B) an existing project | **A**: isolated usage, and keys can be revoked after the session | M05 |
| MEET-3 | Staging access policy (a public token route lets anyone spend Cloud minutes) | A) open + caps (`at.roomConfig = new RoomConfiguration({ maxParticipants: 8, emptyTimeout: 300 })`) B) shared access code `MEET_ACCESS_CODE` + caps C) Google login | **B**: one env var, testable (U11: wrong code returns 401), no OAuth setup | M05 |
| MEET-4 | Venture autonomy level? | L0 / L1 / L2 (section 3) | **L0** during the live session (approval is the on-stage moment), **L1** afterwards | ideate auto-approve |
| MEET-5 | Allow ventures whose oracle needs LiveKit Cloud? | A) yes, verified on staging with Cloud keys after M05 B) local-oracle ventures only | **A**, tagged `oracle: cloud`; they run only after M05 is green | V-07, V-08, V-09 |
| MEET-6 | Third-party keys for AI ventures (STT/LLM, Telegram bot, S3 bucket)? | A) provide now B) provide when such a venture is APPROVED | **B**: the task sits at `- [!]` until the key exists | V-05 to V-08 |
| MEET-7 | Where would an Agents worker run (only if V-05/V-06 are approved)? | A) LiveKit Cloud agent hosting (`lk cloud auth` + `lk agent create`, then `lk agent deploy`) B) own VPS | **A**: no box to babysit | V-05, V-06 |
