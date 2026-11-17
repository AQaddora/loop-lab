export const meta = {
  name: 'build-next',
  description: 'Feature loop: pick the next unblocked backlog task, build it, 3 adversarial reviewers, fix (max 2 rounds), commit + ledger; a stuck task goes to loop/decisions.md',
  whenToUse: 'args {app: "attendance" | "meet", max: 1, deploy?: false}. One iteration = one task of loop/backlog-<app>.md. Repeat it with /loop or a scheduled routine.',
  phases: [
    { title: 'Pick', detail: 'apply answered decisions (unblock [!] tasks; meet: APPROVED ventures become M-tasks), then pick the first open task whose deps are ticked' },
    { title: 'Build', detail: 'one builder implements the task in apps/<app>; its done-when and the full gate must exit 0' },
    { title: 'Review', detail: '3 skeptical lenses in parallel: spec conformance, security/abuse, test quality (unsure = fail)' },
    { title: 'Fix', detail: 'max 2 rounds: a fixer works the high issues / red tests, then only the failing lenses (+ the test lens) re-review' },
    { title: 'Record', detail: 'tick + git commit "loop(<id>): <title>" + ledger merged, or park the attempt, mark [!], open a decision, ledger blocked' },
    { title: 'Deploy', detail: 'only after the deploy target is decided and the first deploy task is ticked; logs deployed' },
  ],
}

// ---------------------------------------------------------------------------
// args: {app, max, deploy}. A loose string such as "attendance max 3" also works.
function parseArgs(a) {
  if (a && typeof a === 'object') return a
  if (typeof a === 'string') {
    try {
      const j = JSON.parse(a)
      if (j && typeof j === 'object') return j
    } catch (e) { /* not JSON */ }
    const app = (a.match(/\b(attendance|meet)\b/) || [])[1]
    const max = (a.match(/max\D{0,3}(\d+)/) || [])[1]
    return { app, max: max ? Number(max) : undefined, deploy: /deploy\W{0,3}false/.test(a) ? false : undefined }
  }
  return {}
}

const A = parseArgs(args)
const APP = A.app === 'attendance' || A.app === 'meet' ? A.app : null
if (!APP) {
  log('build-next: args.app must be "attendance" or "meet"')
  return [{ status: 'error', reason: 'args.app must be "attendance" or "meet"' }]
}
const HARD_CAP = 20 // runaway guard: never more iterations than this per run
let MAX = Math.floor(Number(A.max) || 1)
if (MAX < 1) MAX = 1
if (MAX > HARD_CAP) {
  log(`max ${MAX} capped at ${HARD_CAP} (runaway guard)`)
  MAX = HARD_CAP
}
const FIX_ROUNDS = 2
const DEPLOY = A.deploy !== false
const BACKLOG = `loop/backlog-${APP}.md`
const SPEC = `specs/${APP}.md`
const DIR = `apps/${APP}`
const EV = `loop/log-event.sh feature ${APP}`

// shell-safe text for use inside "double quotes" in a command line
const esc = (s) => String(s == null ? '' : s).replace(/[\\"$`]/g, (m) => '\\' + m).replace(/\s+/g, ' ').slice(0, 160)

const CTX = `You are one step of the loop-lab FEATURE LOOP. It runs unattended: nobody reads this chat, so never ask a question and never wait for input.
Work from the repo root (the git toplevel that contains CLAUDE.md and loop/). App: ${APP}. Spec: ${SPEC}. Backlog: ${BACKLOG}. Code: ${DIR}/.
CLAUDE.md rules apply. Log ledger events only with loop/log-event.sh, exactly as instructed below.`

const GATE_TEXT = `the backlog header's global gate if it names one (attendance: \`npm --prefix apps/attendance run check\`), plus any gate an earlier ticked task says must stay green (meet: \`npm --prefix apps/meet run verify\` once M04 is [x]); if neither exists, \`npm --prefix ${DIR} test\``

// ---------------------------------------------------------------------------
// schemas
const PICK = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    id: { type: 'string', description: 'task id such as T03 or M06; "" if none' },
    title: { type: 'string' },
    doneWhen: { type: 'string', description: 'the exact done-when shell command, without the backticks' },
    notes: { type: 'string', description: "the task's indented note lines, joined with newlines" },
    reason: { type: 'string', description: 'what was applied before picking, or why nothing was picked' },
    deployReady: { type: 'boolean', description: "true only if this app's deploy-target decision is ANSWERED/APPROVED and its first deploy/staging task is [x]" },
    counts: {
      type: 'object',
      properties: { done: { type: 'integer' }, open: { type: 'integer' }, blocked: { type: 'integer' } },
      required: ['done', 'open', 'blocked'],
    },
  },
  required: ['found', 'id', 'title', 'doneWhen', 'notes', 'reason', 'deployReady', 'counts'],
}
const CONVERT = {
  type: 'object',
  properties: {
    applied: {
      type: 'array',
      items: {
        type: 'object',
        properties: { decision: { type: 'string' }, status: { type: 'string' }, effect: { type: 'string' } },
        required: ['decision', 'status', 'effect'],
      },
    },
  },
  required: ['applied'],
}
const BUILD = {
  type: 'object',
  properties: {
    green: { type: 'boolean', description: 'true only if the done-when command AND the full gate both exited 0 in your final run' },
    summary: { type: 'string', description: 'what you did, 1-3 sentences' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testTail: { type: 'string', description: 'last ~30 lines of the final run' },
    needsHuman: { type: 'string', description: 'empty unless a human decision or secret is required: then the exact question with options' },
  },
  required: ['green', 'summary', 'filesChanged', 'testTail', 'needsHuman'],
}
const REVIEW = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'fix'],
      },
    },
  },
  required: ['pass', 'issues'],
}
const RECORD = {
  type: 'object',
  properties: { committed: { type: 'boolean' }, sha: { type: 'string' }, note: { type: 'string' } },
  required: ['committed', 'sha', 'note'],
}
const BLOCK = {
  type: 'object',
  properties: { decisionId: { type: 'string' }, branch: { type: 'string' }, note: { type: 'string' } },
  required: ['decisionId', 'branch', 'note'],
}
const DEPLOYED = {
  type: 'object',
  properties: { deployed: { type: 'boolean' }, skipped: { type: 'boolean' }, url: { type: 'string' }, reason: { type: 'string' } },
  required: ['deployed', 'skipped', 'url', 'reason'],
}

// ---------------------------------------------------------------------------
// review lenses
const SECURITY_FOCUS = {
  attendance: `Can an employee or an outsider manipulate attendance? Attack the change: forge, replay or reuse an expired or foreign QR token; spoof the client IP (leftmost X-Forwarded-For, x-test-client-ip outside test mode); punch from outside the allowlisted networks; reuse a scan ticket or a WebAuthn challenge; punch with a PENDING, REVOKED or another member's passkey; self-approve a credential or self-correct a punch; call /api/admin/* as an employee; CSRF with a foreign Origin; reach /api/test/* or test-login when test mode is off; change or delete attendance rows without breaking the hash chain. Each hole you can show is high.`,
  meet: `Can someone abuse the token route or a room? Attack the change: mint a token for an arbitrary room or identity, or with extra grants (roomAdmin, roomCreate, recorder); pick your own identity to impersonate someone; bypass input validation; leak LIVEKIT_API_SECRET into a client bundle, a response, a log or the ledger; unbounded rooms or participants spending Cloud minutes; a token response without Cache-Control: no-store; venture code trusting data-packet or RPC payloads (spoofed sender, unbounded size). Each hole you can show is high.`,
}

const LENSES = [
  {
    key: 'spec',
    name: 'spec conformance',
    brief: () => `Lens SPEC CONFORMANCE. For every acceptance-criteria id named in the task notes, find (a) the code that implements it and (b) a test whose title starts with that id and that would fail if the behavior were missing. Compare behavior, error codes, routes, status codes and data shapes with ${SPEC} exactly. Anything missing, different, or invented beyond this task's scope is an issue; a missing AC implementation or a missing AC test is high.`,
  },
  {
    key: 'security',
    name: 'security / abuse',
    brief: () => `Lens SECURITY / ABUSE. ${SECURITY_FOCUS[APP]} Also check: secrets hard-coded or staged; test-only bypasses reachable outside the app's test-mode guard; missing authz on new routes; injection; unsafe defaults. Report only what this change introduces or leaves open in the code it touches.`,
  },
  {
    key: 'tests',
    name: 'test quality',
    brief: (t) => `Lens TEST QUALITY (anti reward-hacking). You are the only reviewer that runs commands. From the repo root run the done-when \`${t.doneWhen}\` and the full gate (${GATE_TEXT}) yourself; if either is red that is a high issue, whatever the builder claimed. Then hunt for cheating in the diff: deleted, skipped (.skip/.only/.fixme/xit/test.todo), weakened or tautological tests (expect(true), asserting only on mocks, empty snapshots, catch-all try/catch); asserting message text where the spec says error codes; real-time sleeps instead of the injected clock; ANY change under specs/ or to an acceptance criterion or done-when line (\`git diff HEAD -- specs ${BACKLOG}\` and \`git status --porcelain -- specs\` must both be empty; if \`git ls-files specs\` is empty the specs are untracked, so compare nothing and report that as a high issue); tests that would still pass with the implementation deleted. Each of these is high.`,
  },
]

const verdict = (r) => !!r && r.pass === true && !(r.issues || []).some((i) => i.severity === 'high')
const lensState = (reviews) => Object.fromEntries(LENSES.map((l) => [l.key, reviews[l.key] ? (verdict(reviews[l.key]) ? 'pass' : 'fail') : 'none']))

// ---------------------------------------------------------------------------
// prompts
const convertPrompt = () => `${CTX}
You are the VENTURE CONVERTER, the first step of every meet iteration (specs/meet.md section 3, "Conversion").
In loop/decisions.md find every app: meet venture entry (its title names a V-id) whose status is APPROVED, REJECTED or PARKED and that has no "- loop:" line yet, plus any entry that says "- loop: converted" but is now REJECTED (an after-the-fact veto). For each:
- APPROVED: append 1-3 tasks under "## Venture tasks" in ${BACKLOG} with the next free M-ids, in the exact backlog line format: "- [ ] M06 · <title> — deps: <ids or none> — done when: \`<command>\`" plus 1-3 indented note lines. The done-when targets new tests tests/e2e/v-XX-*.spec.ts or tests/unit/v-XX-*.test.ts, and ends with "&& npm --prefix apps/meet run verify" once M04 is [x]. Put the venture's acceptance check and any constraint from the holder's answer into the notes. If the venture's oracle is cloud or +key and its prerequisite (M05, or the key) is not ready, add the task as "- [!]" with a note naming the missing prerequisite. Set the venture row's status in loop/ventures.md to "approved". Append "- loop: converted -> M06, M07" under the decision.
- REJECTED: set the row to "rejected" and append "- loop: rejected". If it had already been converted, delete its unticked tasks and revert the commits of its ticked ones with git revert --no-edit (find them with git log --grep "loop(Mxx)"), and say so in the loop line.
- PARKED: set the row to "pool (cooldown 3)" and append "- loop: parked".
For each one, log \`loop/log-event.sh venture meet <D-id> decision_answered "<STATUS> <V-id> -> <effect>"\`, unless the ledger already has decision_answered for that D-id.
Also, if every task created from a venture is "- [x]", set its ventures.md row to "built".
Edit only loop/decisions.md, loop/ventures.md and ${BACKLOG}. If you changed anything: git add loop/ && git commit -m "loop(venture): convert <D-ids>". Return what you applied (an empty list if nothing).`

const pickPrompt = (attempted) => `${CTX}
You are the PICKER, step 1 of an iteration.
0. Baseline: if \`git rev-parse HEAD\` fails (no commits yet), or \`git ls-files --error-unmatch ${SPEC} CLAUDE.md .claude/workflows/build-next.js\` fails (the specs and harness were never committed, so the reviewers' \`git diff HEAD -- specs\` anti-cheat check would be blind), commit them first, before anything else: git add -- .gitignore CLAUDE.md LOOPS.md KICKOFF.md README.md specs loop .claude && git commit -m "loop(lab): baseline harness + specs". Change no file content for this.
1. Unblock: for every "- [!]" task in ${BACKLOG}, find the decision(s) it waits on in loop/decisions.md, by D-id or by the spec decision id it names (OD-1, MEET-2 ...). If ALL of them now have status ANSWERED or APPROVED: change "- [!]" to "- [ ]", add an indented note "answer (D-xxx): <the holder's answer, constraints included>", append "- loop: unblocked <task id>" under each such decision, and log \`${EV} <D-id> decision_answered "<STATUS>: unblocked <task id>"\` unless the ledger already has decision_answered for that D-id.
2. Seed: if a "- [!]" task waits on a spec decision that has NO entry in loop/decisions.md, append one in that file's format (next free D-id, status OPEN, title prefixed with the spec id, e.g. "## D-007 · OD-1 · Deploy target?", context/options/recommendation copied from the open-decisions table in ${SPEC}) and log \`${EV} <D-id> decision_needed "<question>"\`.
3. Pick the FIRST "- [ ]" task in file order whose deps are all "- [x]"${attempted.length ? `, skipping ${attempted.join(', ')} (already attempted in this run)` : ''}. Return its id, title, exact done-when command (no backticks) and indented notes (including any answer lines). If there is none, found=false with the reason; and if the backlog has no "- [ ]" and no "- [!]" task left, log \`${EV} - done "backlog complete"\`.
deployReady: true only if a decision for app ${APP} that settles the deploy target is ANSWERED/APPROVED and the backlog's first deploy/staging task is already [x].
counts: the number of [x], [ ] and [!] task lines after your edits.
Write no code. Edit only ${BACKLOG} and loop/decisions.md as described; if you edited either: git add ${BACKLOG} loop/decisions.md loop/ledger.jsonl && git commit -m "loop(lab): apply decisions for ${APP}".`

const buildPrompt = (t) => `${CTX}
You are the BUILDER. Task ${t.id} · ${t.title}
done when: \`${t.doneWhen}\`
notes:
${t.notes}

1. \`${EV} ${t.id} start "build-next: ${esc(t.title)}"\` (keep the "build-next:" prefix: the Stop gate uses it to see that a workflow owns the tree)
2. Read the parts of ${SPEC} that the notes reference, and the current code in ${DIR}/ (it may not exist yet for a scaffold task). Implement ONLY this task. Tests first: write the AC tests named in the notes, watch them fail, then make them pass.
3. From the repo root run the done-when command, then the FULL GATE: ${GATE_TEXT}. Iterate until both exit 0.
4. Log the result of your final run: \`${EV} ${t.id} test_pass "<gate summary>"\` or \`${EV} ${t.id} test_fail "<first failing test>"\`.
Never: edit specs/, an acceptance criterion or a done-when line; skip, delete or weaken a test; tick the backlog; commit; put a secret anywhere except ${DIR}/.env.local. Test-only bypasses go only behind the app's test-mode guard.
If you cannot finish without a human (a missing secret or account, an ambiguity the spec does not settle), stop, leave the tree as it is, and set needsHuman to the exact question with options. Never fake green.
green=true only if the done-when command AND the full gate both exited 0 in your final run.`

const reviewPrompt = (lens, t, build, round) => `${CTX}
You are an adversarial REVIEWER (${lens.name}) for task ${t.id} · ${t.title}${round ? ` (re-review after fix round ${round})` : ''}.
done when: \`${t.doneWhen}\`
notes:
${t.notes}
builder says: ${build ? build.summary : '(the builder returned nothing)'}
files the builder claims to have changed (verify with git): ${build && build.filesChanged.length ? build.filesChanged.join(', ') : '-'}

The change is UNCOMMITTED in the working tree. Inspect it with git status --porcelain, git diff HEAD, and by reading new untracked files. The acceptance criteria are in ${SPEC}.
${lens.brief(t)}
Rules: this is a read-only review, so do not create, modify or delete any file in the repo (scratch work goes in /tmp). ${lens.key === 'tests' ? '' : "Do not start servers, e2e or the done-when command: the test-quality reviewer owns those and the app uses fixed ports. Reading code and running the unit tests is fine."}
Be skeptical and default to pass=false when unsure. pass=true only if you found no high issue. Give every issue a concrete fix.
Last step: log \`${EV} ${t.id} review_pass "${lens.key}: ok"\` if pass, otherwise \`${EV} ${t.id} review_fail "${lens.key}: <n> high, <n> medium; <one-line gist>"\`.`

const fixPrompt = (t, round, issues, green, tail) => `${CTX}
You are the FIXER, round ${round}/${FIX_ROUNDS}, for task ${t.id} · ${t.title}. The change is uncommitted in the working tree.
done when: \`${t.doneWhen}\`
notes:
${t.notes}
${green ? '' : `Tests are RED. Last output:\n${String(tail || '').slice(-3000)}\n`}
Reviewer issues to resolve (fix every high one; fix mediums when cheap):
${issues.length ? issues.map((i) => `- [${i.severity}] (${i.lens}) ${i.file}: ${i.problem} -> fix: ${i.fix}`).join('\n') : '- (none: only the red tests)'}
Fix the CODE. If a reviewer says a test is missing or weak, add or strengthen it (never weaken one). If an issue contradicts ${SPEC}, leave it and say why in your summary, citing the spec line.
Then from the repo root re-run the done-when and the FULL GATE: ${GATE_TEXT}.
Last step: \`${EV} ${t.id} fixed "round ${round}: <what you fixed>"\`.
Same rules as the builder: never edit specs/, acceptance criteria or done-when lines; never skip, delete or weaken tests; never commit or tick.
green=true only if both commands exited 0 in your final run; needsHuman only if a human is truly required.`

const recordPrompt = (t, rounds, minor) => `${CTX}
You are the RECORDER for task ${t.id} · ${t.title}: it is built, green, and passed all 3 reviews${rounds ? ` after ${rounds} fix round(s)` : ''}.
1. Safety check: git status --porcelain must not show a real .env file (only .env.example / .env.e2e are allowed), a key or secret, node_modules or build output. If it does, leave those out of the commit; never commit a secret.
2. In ${BACKLOG} change exactly this task's line from "- [ ] ${t.id}" to "- [x] ${t.id}". Change nothing else.${APP === 'meet' ? ' If the task came from a venture and every task of that venture is now [x], set its row in loop/ventures.md to "built".' : ''}
3. git add -A && git commit -m "loop(${t.id}): ${esc(t.title)}" -m "<body>". Body: "reviews: spec pass, security pass, tests pass; fix rounds: ${rounds}", then one "- [sev] file: problem" line for each remaining minor issue below (at most 5):
${minor.length ? minor.map((i) => `- [${i.severity}] ${i.file}: ${i.problem}`).join('\n') : '(none)'}
4. \`${EV} ${t.id} merged "${esc(t.title)}" <short sha>\`, using the sha from git rev-parse --short HEAD.
Return committed, sha (short) and a one-line note.`

const blockPrompt = (t, why) => `${CTX}
You are the RECORDER for a BLOCKED task ${t.id} · ${t.title}. It could not be made green and clean within ${FIX_ROUNDS} fix rounds, or it needs a human.
Why:
${why}
1. Park the attempt so the main tree is green again: git switch -c loop/blocked-${t.id} (if that branch exists, add -2, -3 ...), git add -A -- ${DIR}, git commit -m "wip(${t.id}): blocked attempt" (skip the commit if nothing is staged), then git switch - back to the original branch. Touch nothing else. Afterwards \`git status --porcelain\` should list only loop/ files; name anything else that is left over in your note.
2. In ${BACKLOG} change this task's "- [ ]" to "- [!]" and add an indented note "blocked: D-xxx (attempt on branch <branch>)".
3. Append ONE decision entry to loop/decisions.md in that file's format: next free D-id, "app: ${APP} | status: OPEN", the question the holder must answer to unblock it; context = the unresolved issues or failing test in 2-4 lines plus the branch; options A) B) (C)) such as clarify or relax the AC in the spec, provide the secret, split the task, accept the risk; a one-line recommendation.
4. \`${EV} ${t.id} blocked "<one-line why>"\` and \`${EV} <D-id> decision_needed "<the question>"\`.
5. git add ${BACKLOG} loop/decisions.md loop/ledger.jsonl && git commit -m "loop(${t.id}): blocked -> <D-id>".
Never mark the task done; never edit specs or tests.`

const deployPrompt = (t, sha) => `${CTX}
You are the DEPLOYER, the deploy step at the end of the feature loop. First check it is really enabled; if not, change nothing and return skipped=true with the reason.
Enabled only if ALL hold: (a) loop/decisions.md has an ANSWERED/APPROVED decision for app ${APP} that settles the deploy target (attendance: OD-1; meet: MEET-1..3); (b) the backlog's own first deploy/staging task is already [x] (that task did the first deploy; you redeploy after later merges); (c) the deploy credentials exist (loop/secrets.sh names ${APP}, or ${DIR}/.env.local). Never print secret values.
If enabled: deploy commit ${sha} the way ${SPEC}'s deploy section and the ticked deploy task's notes describe, then run that task's done-when against the deployed URL as the deploy oracle.
- pass: \`loop/log-event.sh deploy ${APP} ${t.id} deployed "<url>" ${sha}\`
- fail: redeploy the previous green commit, log test_fail and then blocked (loop deploy), and append one decision entry (next D-id) describing the failure. Retry at most once.
Never commit secrets, and never change app code to make a deploy pass.`

// ---------------------------------------------------------------------------
// the loop
const results = []
const attempted = []

for (let i = 0; i < MAX; i++) {
  const n = `${i + 1}/${MAX}`

  phase('Pick')
  if (APP === 'meet') {
    const conv = await agent(convertPrompt(), { label: `convert ventures ${n}`, phase: 'Pick', schema: CONVERT })
    if (conv && conv.applied.length) log(`ventures applied: ${conv.applied.map((a) => `${a.decision} ${a.status} -> ${a.effect}`).join('; ')}`)
  }
  const pick = await agent(pickPrompt(attempted), { label: `pick ${n}`, phase: 'Pick', schema: PICK })
  if (!pick) {
    log('the picker returned nothing; stopping')
    results.push({ iteration: i + 1, status: 'error', reason: 'picker returned nothing' })
    break
  }
  if (!pick.found || !pick.id) {
    log(`nothing to build in ${BACKLOG}: ${pick.reason}`)
    results.push({ iteration: i + 1, status: 'none', reason: pick.reason, counts: pick.counts })
    break
  }
  const t = { id: pick.id, title: pick.title, doneWhen: pick.doneWhen, notes: pick.notes || '-' }
  attempted.push(t.id)
  log(`${n} picked ${t.id} · ${t.title} (done ${pick.counts.done}, open ${pick.counts.open}, blocked ${pick.counts.blocked})`)

  // ---- build
  phase('Build')
  let build = await agent(buildPrompt(t), { label: `build ${t.id}`, phase: 'Build', schema: BUILD })
  let green = !!(build && build.green)
  let tail = build ? build.testTail : 'the builder agent returned nothing (it died or was skipped)'
  let blockedWhy = ''
  log(`${t.id} build: ${green ? 'green' : 'RED'}${build ? ` · ${build.summary.slice(0, 140)}` : ''}`)
  if (build && build.needsHuman && !green) blockedWhy = `needs a human: ${build.needsHuman}`

  // ---- review (3 lenses in parallel) + fix rounds
  const reviews = {}
  let rounds = 0
  if (!blockedWhy) {
    phase('Review')
    const first = await parallel(LENSES.map((l) => () =>
      agent(reviewPrompt(l, t, build, 0), { label: `review ${l.key} ${t.id}`, phase: 'Review', schema: REVIEW })))
    LENSES.forEach((l, k) => { reviews[l.key] = first[k] })
    let failing = LENSES.filter((l) => !verdict(reviews[l.key]))
    log(`${t.id} review: ${LENSES.map((l) => `${l.key} ${verdict(reviews[l.key]) ? 'pass' : 'FAIL'}`).join(', ')}`)

    while ((failing.length || !green) && rounds < FIX_ROUNDS) {
      rounds++
      phase('Fix')
      const issues = failing.flatMap((l) => reviews[l.key]
        ? reviews[l.key].issues.filter((x) => x.severity !== 'low').map((x) => ({ ...x, lens: l.key }))
        : [{ severity: 'high', lens: l.key, file: '-', problem: `the ${l.name} reviewer returned nothing, so the change is unreviewed`, fix: 'make the change obviously correct and fully tested' }])
      const fix = await agent(fixPrompt(t, rounds, issues, green, tail), { label: `fix ${t.id} r${rounds}`, phase: 'Fix', schema: BUILD })
      if (fix) {
        const files = new Set([...(build ? build.filesChanged : []), ...fix.filesChanged])
        build = { ...fix, filesChanged: [...files] }
        green = fix.green
        tail = fix.testTail
      } else {
        green = false
        tail = 'the fixer agent returned nothing'
      }
      if (fix && fix.needsHuman && !green) {
        blockedWhy = `needs a human: ${fix.needsHuman}`
        break
      }
      // re-run only the failing lenses, plus the test lens: it re-runs the oracle on the changed code
      const again = LENSES.filter((l) => l.key === 'tests' || failing.includes(l))
      const rr = await parallel(again.map((l) => () =>
        agent(reviewPrompt(l, t, build, rounds), { label: `re-review ${l.key} ${t.id} r${rounds}`, phase: 'Fix', schema: REVIEW })))
      again.forEach((l, k) => { reviews[l.key] = rr[k] })
      failing = LENSES.filter((l) => !verdict(reviews[l.key]))
      log(`${t.id} fix round ${rounds}: tests ${green ? 'green' : 'RED'}; failing lenses: ${failing.map((l) => l.key).join(', ') || 'none'}`)
    }
    if (!blockedWhy && (failing.length || !green)) {
      const highs = failing.flatMap((l) => reviews[l.key]
        ? reviews[l.key].issues.filter((x) => x.severity === 'high').map((x) => `- [${l.key}] ${x.file}: ${x.problem}`)
        : [`- [${l.key}] reviewer returned nothing`])
      blockedWhy = [`still failing after ${rounds} fix round(s); tests ${green ? 'green' : 'RED'}`, ...highs.slice(0, 8),
        green ? '' : `test tail:\n${String(tail || '').slice(-1200)}`].filter(Boolean).join('\n')
    }
  }

  // ---- record
  phase('Record')
  if (blockedWhy) {
    const b = await agent(blockPrompt(t, blockedWhy), { label: `block ${t.id}`, phase: 'Record', schema: BLOCK })
    log(`${t.id} BLOCKED -> ${b ? b.decisionId : '?'} (${blockedWhy.split('\n')[0].slice(0, 160)})`)
    results.push({ iteration: i + 1, id: t.id, title: t.title, status: 'blocked', why: blockedWhy, decision: b ? b.decisionId : '', branch: b ? b.branch : '', fixRounds: rounds, reviews: lensState(reviews) })
    break // a blocked task stops the run; the next run picks the next unblocked task
  }
  const minor = LENSES.flatMap((l) => (reviews[l.key] ? reviews[l.key].issues : []).filter((x) => x.severity !== 'high')).slice(0, 5)
  const rec = await agent(recordPrompt(t, rounds, minor), { label: `record ${t.id}`, phase: 'Record', schema: RECORD })
  if (!rec || !rec.committed) {
    log(`${t.id}: the recorder did not commit (${rec ? rec.note : 'agent returned nothing'}); stopping`)
    results.push({ iteration: i + 1, id: t.id, title: t.title, status: 'error', reason: 'commit failed', fixRounds: rounds, reviews: lensState(reviews) })
    break
  }
  log(`${t.id} merged ${rec.sha}${rounds ? ` after ${rounds} fix round(s)` : ''}`)

  // ---- deploy (only once a deploy target is decided and the first deploy task is done)
  let deploy = DEPLOY ? 'not ready' : 'off'
  if (DEPLOY && pick.deployReady) {
    phase('Deploy')
    const d = await agent(deployPrompt(t, rec.sha), { label: `deploy ${t.id}`, phase: 'Deploy', schema: DEPLOYED })
    deploy = d ? (d.deployed ? d.url : `${d.skipped ? 'skipped' : 'FAILED'}: ${d.reason}`) : 'deployer returned nothing'
    log(`${t.id} deploy: ${deploy}`)
    results.push({ iteration: i + 1, id: t.id, title: t.title, status: 'merged', sha: rec.sha, fixRounds: rounds, reviews: lensState(reviews), deploy })
    if (d && !d.deployed && !d.skipped) break // a failed deploy is a blocker; it already opened a decision
    continue
  }
  results.push({ iteration: i + 1, id: t.id, title: t.title, status: 'merged', sha: rec.sha, fixRounds: rounds, reviews: lensState(reviews), deploy })
}

const merged = results.filter((r) => r.status === 'merged').length
log(`build-next ${APP}: ${merged} merged, ${results.length - merged} other, of max ${MAX}`)
return results
