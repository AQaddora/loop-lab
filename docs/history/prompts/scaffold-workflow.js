export const meta = {
  name: 'loop-lab-scaffold',
  description: 'Scaffold ~/loop-lab: attendance + LiveKit specs, loop harness, observability; adversarially review each; integrate',
  phases: [
    { title: 'Scaffold', detail: 'attendance spec, meet spec, loop harness in parallel' },
    { title: 'Review', detail: 'adversarial review-and-fix of each piece as it lands' },
    { title: 'Integrate', detail: 'cross-file consistency + open decisions' },
  ],
}

const ROOT = '~/loop-lab'
const SCRATCH = '<scratchpad>'

const CONTEXT = `
You are helping build "loop-lab" at ${ROOT} (fresh git repo, empty dirs: specs/, loop/, apps/, .claude/workflows/).
Purpose: a live teaching session on "the loop" — showing how AI agent loops can build, review, test and deploy a complete
system with MINIMUM human involvement. The human is ON the loop (designs it, holds decisions), not IN it.
Two demo projects:
  1) "attendance" — on-site attendance web app: rotating QR + office Wi-Fi IP allowlist + Google login + WebAuthn passkey
     (fingerprint/Face ID) + admin approval of new credentials. This is the CLOSED loop demo: spec -> tests as oracle -> converges.
  2) "meet" — a LiveKit Cloud meeting app that starts tiny and grows through a VENTURE loop: agents propose features,
     the loop holder approves/rejects in loop/decisions.md, approved ones flow into the backlog and get built + deployed.

FIXED FILE CONTRACT (use exactly these paths so pieces fit together):
  README.md, CLAUDE.md, LOOPS.md, KICKOFF.md
  specs/attendance.md, specs/meet.md
  loop/backlog-attendance.md, loop/backlog-meet.md   (task checklists, format below)
  loop/ventures.md        (pool of feature ideas for meet)
  loop/decisions.md       (queue of questions for the loop holder)
  loop/ledger.jsonl       (append-only event log, one JSON object per line; starts empty)
  loop/log-event.sh       (usage: loop/log-event.sh <loop> <app> <task> <event> "<detail>")
  loop/observe.sh         (live view + "summary" subcommand)
  loop/hooks/*.sh         (Claude Code hook scripts)
  .claude/settings.json   (project hooks)
  .claude/workflows/build-next.js, .claude/workflows/ideate.js
  apps/attendance/, apps/meet/   (app code — created LATER by the loop, NOT now)

BACKLOG LINE FORMAT (both backlogs):
  - [ ] T01 · <title> — deps: none — done when: \`<shell command run from repo root that exits 0>\`
    <1-3 indented lines of notes / acceptance criteria ids>
  ids: attendance = T01.., meet = M01..; tick to "- [x]" when done; "- [!]" = blocked (see decisions.md).

LEDGER EVENT: {"ts":"<ISO UTC>","loop":"inner|feature|venture|deploy","app":"attendance|meet|lab","task":"T03","event":"<event>","detail":"...","commit":"<sha or empty>"}
  events: start, test_pass, test_fail, review_pass, review_fail, fixed, merged, deployed, decision_needed, decision_answered, blocked, done, session_start

DECISION ENTRY FORMAT (loop/decisions.md):
  ## D-001 · <question>
  - app: attendance | status: OPEN   (OPEN | ANSWERED | APPROVED | REJECTED | PARKED)
  - context: ...
  - options: A) ... B) ...
  - recommendation: ...
  - answer: _(loop holder writes here)_

Do NOT write application code now. Write only the files assigned to you. Be concrete and practical, not fluffy.
Markdown should be tight: tables and checklists over prose.
`

const SCAFFOLD_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    openDecisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          app: { type: 'string' }, question: { type: 'string' }, context: { type: 'string' },
          options: { type: 'string' }, recommendation: { type: 'string' },
        },
        required: ['app', 'question', 'options', 'recommendation'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['files', 'openDecisions', 'notes'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixed', 'remaining'],
}

const ATTENDANCE = `${CONTEXT}
YOUR JOB: write specs/attendance.md and loop/backlog-attendance.md.

Product (from the session owner's words): admin creates the organization and site(s), allowlists employee IDs/emails and the
office public Wi-Fi egress IPs (CIDRs). Admin generates a QR for the org with a TTL. Employee scans QR -> web app opens ->
request accepted only if the client IP is in the site's allowlist -> "Sign in with Google" -> first time: fill details
(name, employee id, phone...) + register fingerprint/Face ID -> pending admin approval. After approval: simple check-in /
check-out log. If the employee deletes the passkey or changes phone, next login they register a new one on the SAME Google
account, and the admin must approve the new credential from the dashboard (old one revoked on approval). The system must
resist manipulation.

Spec must contain:
 1. Roles & flows (admin, kiosk display, employee) — numbered steps, including first-time, daily in/out, new-device re-registration.
 2. Anti-manipulation design: rotating kiosk QR (HMAC-signed token over org/site/time-window, rotation e.g. 30s, 1-window grace)
    AND the simpler static QR-with-TTL the owner described (printed; weaker; admin chooses per site). IP allowlist from trusted
    proxy header only (never trust raw X-Forwarded-For; IPv4+IPv6 CIDR). WebAuthn passkey: authenticatorAttachment platform,
    userVerification required, single-use server challenges with short expiry; record AAGUID, backup-eligible/backup-state flags,
    UA, IP, time. One APPROVED credential per employee; new ones PENDING. Check-in requires ALL of: valid QR ticket + allowed IP +
    fresh UV assertion with an APPROVED credential + valid state transition. Server time only. Hash-chained append-only attendance
    log (tamper-evident); admin corrections are new rows with a reason. Rate limits, secure cookies, CSRF.
 3. THREAT TABLE: threat | attack | mitigation | residual risk. Include buddy punching, remote check-in, forwarding a QR photo,
    VPN, header spoofing, replay, lost/new phone, stolen phone, passcode fallback, admin abuse, clock tampering, test-mode bypass
    leaking to prod. BE HONEST about limits: the server never sees a fingerprint — it verifies a passkey; iCloud/Google passkeys
    sync across a user's devices so strict device binding is not possible on iOS; OS passcode fallback can satisfy UV.
 4. Data model (tables + key columns + statuses).
 5. API / routes list.
 6. Stack: Next.js (App Router, TypeScript), Auth.js with Google provider (+ optional hd domain restriction), @simplewebauthn/server
    and @simplewebauthn/browser, Drizzle ORM with SQLite for dev/test (Postgres-ready), Vitest for unit, Playwright for E2E.
    Env vars list (.env.example). App lives in apps/attendance.
 7. AUTOMATED TEST ORACLE — this is what lets the loop run without humans: Playwright + Chrome DevTools Protocol WebAuthn virtual
    authenticator (WebAuthn.enable, WebAuthn.addVirtualAuthenticator with protocol ctap2, transport internal, hasUserVerification
    true, isUserVerified true); a TEST-ONLY sign-in provider enabled only when NODE_ENV=test AND AUTH_TEST_MODE=1 (and a test that
    proves it is absent in a production build); client IP injected via a test-only header honored only in test mode; QR tokens
    minted via a test helper with an injectable clock.
 8. ACCEPTANCE CRITERIA AC-01..AC-NN, each one line, each mapped to a named test file/test name. Include abuse cases
    (wrong IP rejected, expired QR rejected, replayed challenge rejected, pending credential cannot check in, double check-in
    rejected, tampered log row detected, non-allowlisted Google account rejected).
 9. "Open decisions" section (things only the loop holder can decide: deploy target, Google Workspace domain restriction,
    QR mode default, data retention, whether to allow synced passkeys...).

Backlog: ~14-16 small ordered tasks T01..T1x, each completable in ONE agent iteration (~1 PR), each with deps and a real
"done when" command (e.g. \`npm --prefix apps/attendance test -- tests/unit/ip.test.ts\` or \`npm --prefix apps/attendance run e2e -- --grep AC-05\`).
T01 = scaffold the Next.js app with Vitest + Playwright + one green smoke test + lint/typecheck scripts. Last tasks = full E2E
journey + abuse suite, then staging deploy (blocked on a decision). Reference AC ids in task notes.
Return the list of files you wrote and the open decisions (also listed in the spec).`

const MEET = `${CONTEXT}
YOUR JOB: write specs/meet.md, loop/backlog-meet.md and loop/ventures.md.

specs/meet.md must contain:
 1. v0 scope (tiny on purpose): Next.js (App Router, TS) app in apps/meet; a server route that mints LiveKit access tokens with
    livekit-server-sdk (AccessToken + VideoGrant: roomJoin, room); a join page (room name + display name); the room view using
    @livekit/components-react prebuilt VideoConference (+ @livekit/components-styles); mic/cam toggle; leave. Env: LIVEKIT_URL,
    LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Token route must validate input and never expose the secret.
 2. AUTOMATED TEST ORACLE so the loop needs no humans: local LiveKit dev server (docker run livekit/livekit-server --dev ->
    ws://localhost:7880, devkey/secret) for tests; Playwright Chromium with --use-fake-ui-for-media-stream and
    --use-fake-device-for-media-stream; two browser contexts join the same room and each must see 2 participants; plus a server-side
    assertion via RoomServiceClient.listParticipants. Unit tests for token minting (grants, ttl, identity). Cloud keys only for deploy.
 3. The VENTURE LOOP explained for this app: ideate workflow proposes features through 4 lenses (user value for a small team,
    differentiator, cheapest on LiveKit primitives, wow-demo for a live audience) -> judge panel scores -> top 3 queued in
    loop/decisions.md as OPEN -> loop holder writes APPROVED/REJECTED/PARKED -> next build-next run converts APPROVED ventures into
    backlog-meet tasks -> built, reviewed, deployed. Scoring rubric table (value, effort, risk, demo-ability, 1-5 each).
 4. Deploy approach options (e.g. Vercel/Netlify/own box) as an open decision; LiveKit Cloud project keys are a human-provided secret.
 5. "Open decisions" section.
loop/backlog-meet.md: M01 scaffold app (+ Vitest + Playwright + smoke test), M02 token route + unit tests, M03 join page + room UI,
 M04 two-participant E2E against local LiveKit dev server, M05 staging deploy (blocked on decision). Same line format, real
 "done when" commands (npm --prefix apps/meet ...).
loop/ventures.md: a pool table of ~15 candidate features with id V-01.., title, one-line pitch, LiveKit primitive used
 (data channel chat, screen share track, Egress recording, Agents + STT live captions, AI meeting-notes agent, hand raise via
 participant attributes, reactions, lobby/waiting room, breakout rooms, expiring invite links, summary sent to Telegram, noise
 cancellation, background blur, simulcast/adaptive stream...), effort S/M/L, status (pool|queued|approved|built|rejected).
Use accurate current package names and APIs; if unsure about a LiveKit API detail, check it with web search before writing it.
Return the files you wrote and the open decisions.`

const HARNESS = `${CONTEXT}
YOUR JOB: write the loop harness: README.md, CLAUDE.md, LOOPS.md, KICKOFF.md, loop/decisions.md (header + format + empty queue),
loop/ledger.jsonl (empty file), loop/log-event.sh, loop/observe.sh, loop/hooks/session-start.sh, loop/hooks/stop-gate.sh,
.claude/settings.json, .claude/workflows/build-next.js, .claude/workflows/ideate.js, .gitignore. chmod +x all .sh files.
Other agents are writing specs/* , loop/backlog-*.md and loop/ventures.md in parallel — don't write those.

LOOPS.md — theory -> practice. The three nested loops:
  inner loop (minutes): one agent session edits code, runs tests; the Stop hook is the loop: it refuses to let the agent stop
    while tests are red (oracle = tests).
  feature loop (hours): build-next workflow = pick next task -> build -> 3 adversarial reviewers -> fix (max 2 rounds) -> commit
    -> ledger; repeated by /loop (self-paced) or a cron/scheduled routine (oracle = acceptance tests + reviewers).
  venture loop (days): ideate workflow proposes + judges features -> loop holder decides in decisions.md (oracle = human judgment).
  (+ deploy step at the end of the feature loop once a deploy target is decided.)
 The 6 properties every unattended loop needs: goal, action, oracle (automatic check), stop condition, memory (ledger + git),
 escalation path (decisions.md). Table mapping each to the file/primitive in this repo. Human touchpoints table (secrets,
 decisions, approving spec changes) — everything else is automated. Failure modes + guards: runaway loop (max iterations,
 retry caps), reward hacking (deleting/skipping tests, editing acceptance criteria -> test-quality reviewer + CLAUDE.md rule),
 spec drift, cost. Short ASCII diagram of the nested loops.

CLAUDE.md — rules for every agent in this repo: spec files are source of truth; work one backlog task per iteration in
 order; NEVER ask the human in chat during a loop: write a decision entry + log decision_needed, then take the next unblocked
 task or stop; never weaken/skip/delete tests or edit acceptance criteria to go green (only the loop holder edits ACs); log
 events with loop/log-event.sh; commit format "loop(T03): <title>"; secrets only in apps/*/.env.local (gitignored); test-only
 bypasses only behind NODE_ENV=test.

loop/log-event.sh: appends one compact JSON line (jq -nc, ts from date -u +%Y-%m-%dT%H:%M:%SZ) to loop/ledger.jsonl (resolve repo
 root from the script location so it works from any cwd); optional Telegram ping ONLY if env LOOP_TG_TOKEN and LOOP_TG_CHAT are
 set, only for events merged|blocked|decision_needed|deployed, curl with --data-urlencode, never fail the caller if it errors.
loop/observe.sh: default = live colored tail (tail -n 30 -F | jq) ; "summary" = backlog progress per app ([x]/[ ]/[!] counts),
 last 10 events, OPEN decisions count + titles, last commit. Must work with an empty ledger.
loop/hooks/session-start.sh: prints a short context block (backlog progress, next task per app, OPEN decisions) to stdout —
 SessionStart hook stdout is injected into the agent's context, so every new session "remembers" where the loop is; logs session_start.
loop/hooks/stop-gate.sh: Stop hook. Reads hook JSON from stdin. Gate is active only if file loop/.gate exists AND
 apps/<app>/package.json exists for the app named in loop/.gate (file content = app name). Runs \`npm --prefix apps/<app> test --silent\`;
 if red: log test_fail, print a concise reason (last ~40 lines) to stderr and exit 2 (this makes Claude continue working);
 cap retries at 3 using a counter file loop/.gate-retries (reset on green; when cap hit, log blocked and exit 0 so it can't loop
 forever). Green: log test_pass, exit 0. Add loop/.gate and loop/.gate-retries to .gitignore.
.claude/settings.json: {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"\\"$CLAUDE_PROJECT_DIR\\"/loop/hooks/session-start.sh"}]}],
 "Stop":[{"hooks":[{"type":"command","command":"\\"$CLAUDE_PROJECT_DIR\\"/loop/hooks/stop-gate.sh","timeout":900}]}]}} (valid JSON).

WORKFLOW SCRIPTS (.claude/workflows/*.js) — Claude Code Workflow tool format. Plain JavaScript (NOT TypeScript). Must start with
 export const meta = { name, description, phases: [{title, detail}] }  — a PURE LITERAL (no variables/calls/template strings).
 Body runs in async context, top-level await ok. Globals: agent(prompt, {label, phase, schema, effort, isolation:'worktree'}) ->
 Promise (string, or validated object when schema given; null if the agent died/skipped — always handle null);
 parallel([() => promise, ...]) -> barrier, failed thunks resolve to null; pipeline(items, stage1, stage2...) -> per-item stages
 without barrier, stage gets (prev, item, index); phase(title); log(msg); args (input value). Schemas: {type:'object',
 properties:{...}, required:[...]} with required ⊆ properties. FORBIDDEN: Date.now(), Math.random(), new Date() without args,
 require/import, fs. Agents do all file/shell work; the script only orchestrates. Phase titles in meta must match phase() calls.

 build-next.js — args {app:'attendance'|'meet', max: number (default 1)}. For i < max:
   Pick: agent reads loop/backlog-<app>.md (+ for app meet: first converts any APPROVED venture in loop/decisions.md into new
     backlog-meet tasks and marks the decision + ventures.md row accordingly); returns {found, id, title, doneWhen, notes} for the
     first unticked task whose deps are ticked; none -> log and stop.
   Build: agent implements the task in apps/<app> following CLAUDE.md + specs/<app>.md, logs start, runs the done-when command and
     the full test suite, returns {green, summary, filesChanged, testTail}.
   Review: 3 parallel skeptical reviewers with distinct lenses — spec conformance (vs acceptance criteria), security/abuse
     (for attendance: can this be manipulated?), test quality (tests really assert behavior; nothing skipped/weakened; ACs untouched)
     -> {pass, issues:[{severity:'high'|'medium'|'low', file, problem, fix}]}; default to fail when unsure.
   Fix: up to 2 rounds: if any high issues or not green -> fixer agent -> re-run only the failing lenses.
   Still failing -> agent marks the task "- [!]" in the backlog, appends a decision entry describing the blocker, logs blocked; stop.
   Record: agent ticks the task, runs git add -A && git commit -m "loop(<id>): <title>", logs merged with the short sha.
   Return a summary array. Log progress with log().
 ideate.js — args {app:'meet', top: 3}. Propose: 4 parallel lens agents (see LOOPS.md venture loop) read specs/meet.md +
   loop/ventures.md + loop/decisions.md and return {ideas:[{title,pitch,effort,primitive,acceptance}]} avoiding duplicates;
   dedupe by lowercase title in plain JS; Judge: 3 parallel judges score every idea (value, effort, risk, demo 1-5) ->
   average in plain JS -> top N; Queue: one agent appends top N as OPEN decision entries (next D-ids) and adds/updates rows in
   loop/ventures.md (status queued), logs decision_needed per item. Returns the top list.

KICKOFF.md — copy-paste prompts for a NEW Claude Code session opened in ${ROOT}:
 Loop 0 (build the attendance base): echo attendance > loop/.gate; then prompt: "Run the build-next workflow with args
 {app:'attendance', max:3}" (Workflow tool by name build-next, or by scriptPath .claude/workflows/build-next.js).
 Repeat unattended: "/loop run the build-next workflow for attendance with max 1; stop the loop when the backlog has no unblocked
 tasks" (self-paced /loop), or a cron cadence like "/loop 20m ...". Venture loop: "/loop 30m run the ideate workflow for meet".
 Cloud/unattended overnight: /schedule a routine. Observe: open a terminal tab running loop/observe.sh; loop/observe.sh summary;
 /workflows to watch agents live; git log --oneline; loop/decisions.md is the loop holder's inbox. Note how the loop holder answers
 (edit decisions.md status + answer, then log decision_answered).
README.md — what this is, the tree, 60-second quickstart, links to LOOPS.md / KICKOFF.md / specs.

Before returning: bash -n every .sh; jq . .claude/settings.json; copy each workflow .js to ${SCRATCH}/<name>.mjs and run node --check
on it; run loop/log-event.sh lab lab - session_start "smoke" then loop/observe.sh summary to prove they work, then truncate
loop/ledger.jsonl back to empty. Return the files you wrote (openDecisions may be empty).`

const REVIEWS = {
  attendance: `${CONTEXT}
You are an ADVERSARIAL REVIEWER. Read specs/attendance.md and loop/backlog-attendance.md. Act as (a) a dishonest employee
trying to mark attendance without being on site or for a friend, (b) a dishonest admin, (c) an engineer who must build each
backlog task in one agent iteration with NO human help. Find gaps: an attack with no mitigation, a mitigation that is wrong
(e.g. trusting X-Forwarded-For, reusable challenges, test-mode bypass reachable in prod, QR token not bound to time window,
state machine holes), overclaims (claiming device binding or that the server sees biometrics), acceptance criteria that are
not automatable, tasks too large, missing deps, done-when commands that cannot exit 0 or don't exist. FIX the issues directly
in those two files (keep the structure). Return what you fixed and anything you could not fix.`,
  meet: `${CONTEXT}
You are a SKEPTICAL REVIEWER. Read specs/meet.md, loop/backlog-meet.md, loop/ventures.md. Verify every LiveKit package name,
class and API mentioned is real and current (use web search to check livekit-server-sdk AccessToken/VideoGrant/RoomServiceClient,
@livekit/components-react VideoConference, livekit-server --dev defaults, Chromium fake media flags). Check the test oracle can
run with zero humans and zero cloud keys, each backlog task fits one agent iteration, done-when commands are real, venture rows
are concrete. FIX issues directly in those files. Return what you fixed and what remains.`,
  harness: `${CONTEXT}
You are a SKEPTICAL REVIEWER of the loop harness. Assume it will run UNATTENDED for hours. Check and fix in place:
 - .claude/workflows/build-next.js and ideate.js: copy each to ${SCRATCH}/<name>-review.mjs and node --check; meta is a pure
   literal; phase titles match; no Date.now/Math.random/new Date(); every agent() result null-checked; schemas valid
   (required ⊆ properties); loops bounded (max iterations, max fix rounds); no barrier where not needed; prompts tell agents
   exact files; blocked path writes decision + stops.
 - .claude/settings.json valid JSON with the SessionStart + Stop hooks; hook scripts executable; bash -n passes.
 - stop-gate.sh: simulate with echo '{"stop_hook_active":false}' | loop/hooks/stop-gate.sh (no loop/.gate -> must exit 0 fast);
   then create a temp gate pointing at a nonexistent app -> must exit 0; retry cap logic can never loop forever; clean up.
 - session-start.sh and observe.sh summary must work even if backlog/ventures files are missing or the ledger is empty.
 - log-event.sh: produces valid JSON lines (jq -c . loop/ledger.jsonl), handles quotes in detail, Telegram optional and non-fatal.
 - CLAUDE.md / LOOPS.md / KICKOFF.md / README.md are accurate to what the scripts actually do.
After testing, truncate loop/ledger.jsonl to empty and remove any loop/.gate* you created. Return fixed + remaining.`,
}

phase('Scaffold')
const PIECES = [
  { key: 'attendance', prompt: ATTENDANCE },
  { key: 'meet', prompt: MEET },
  { key: 'harness', prompt: HARNESS },
]

const results = await pipeline(
  PIECES,
  (_, p) => agent(p.prompt, { label: `scaffold:${p.key}`, phase: 'Scaffold', schema: SCAFFOLD_SCHEMA }),
  (built, p) => agent(REVIEWS[p.key], { label: `review:${p.key}`, phase: 'Review', schema: REVIEW_SCHEMA })
    .then(review => ({ key: p.key, built, review })),
)

const ok = results.filter(Boolean)
const decisions = ok.flatMap(r => (r.built && r.built.openDecisions) || [])
log(`scaffolded ${ok.length}/3 pieces, ${decisions.length} open decisions to queue`)

phase('Integrate')
const integration = await agent(`${CONTEXT}
You are the INTEGRATOR / completeness critic. All pieces are written. Do this:
 1. Append these open decisions to loop/decisions.md as D-001.. entries in the exact DECISION ENTRY FORMAT (status OPEN),
    merging duplicates, ordered by how soon the loop will block on them:
    ${JSON.stringify(decisions)}
 2. Cross-file consistency: every path referenced in README.md, CLAUDE.md, LOOPS.md, KICKOFF.md, specs, backlogs and the workflow
    scripts exists or is explicitly "created by the loop later"; task id formats match what build-next.js parses; event names
    match the ledger contract; README tree matches reality (find . -path ./.git -prune -o -type f -print). Fix mismatches.
 3. Run loop/observe.sh summary and loop/hooks/session-start.sh and include their output in your report.
 4. Do NOT commit. Return a concise report: final file tree, what you fixed, anything still weak.`,
  { label: 'integrate', phase: 'Integrate' })

return {
  pieces: ok.map(r => ({ key: r.key, files: r.built && r.built.files, notes: r.built && r.built.notes, reviewFixed: r.review && r.review.fixed, reviewRemaining: r.review && r.review.remaining })),
  integration,
}
