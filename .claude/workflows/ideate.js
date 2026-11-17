export const meta = {
  name: 'ideate',
  description: 'Venture loop for meet: 4 lens proposers -> 3 judges score every idea (median per criterion) -> top N queued as OPEN decisions for the loop holder',
  whenToUse: 'args {app: "meet", top: 3, force?: false, autonomy?: "L0" | "L1" | "L2"}. Run when the meet backlog runs dry or the holder asks; it skips while 3+ venture decisions are OPEN (WIP cap).',
  phases: [
    { title: 'Scan', detail: 'OPEN venture decisions (WIP cap 3), next D-/V-ids, pool rows, autonomy level (MEET-4)' },
    { title: 'Propose', detail: '4 lens agents: U user value, D differentiator, C cheapest on LiveKit, W wow-demo (2-3 ideas each)' },
    { title: 'Judge', detail: '3 judges (product, engineer, demo host) score value/effort/risk/demo 1-5 and the gates; median per criterion' },
    { title: 'Queue', detail: 'top N become OPEN decision entries + ventures.md rows + scoring log; ledger decision_needed' },
  ],
}

// ---------------------------------------------------------------------------
function parseArgs(a) {
  if (a && typeof a === 'object') return a
  if (typeof a === 'string') {
    try {
      const j = JSON.parse(a)
      if (j && typeof j === 'object') return j
    } catch (e) { /* not JSON */ }
    const top = (a.match(/top\D{0,3}(\d+)/) || [])[1]
    const level = (a.match(/\bL[012]\b/) || [])[0]
    return { app: /\bmeet\b/.test(a) ? 'meet' : (a.match(/\b(attendance)\b/) || [])[1], top: top ? Number(top) : undefined, force: /\bforce\b/.test(a), autonomy: level }
  }
  return {}
}

const A = parseArgs(args)
const APP = A.app || 'meet'
if (APP !== 'meet') {
  log(`ideate: only app "meet" has a venture loop (got "${APP}"); attendance is a closed spec loop`)
  return { skipped: true, reason: 'only meet has a venture loop', top: [] }
}
let TOP = Math.floor(Number(A.top) || 3)
if (TOP < 1) TOP = 1
if (TOP > 5) {
  log(`top ${TOP} capped at 5: the loop holder is the bottleneck by design`)
  TOP = 5
}
const WIP = 3
const MIN_TOTAL = 12
const FORCE = A.force === true

const CTX = `You are one step of the loop-lab VENTURE LOOP for the meet app (specs/meet.md section 3). It runs unattended: nobody reads this chat, so never ask a question.
Work from the repo root (the git toplevel that contains CLAUDE.md and loop/). CLAUDE.md rules apply.`

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const isVid = (s) => /^V-\d+$/.test(String(s || '').trim())
const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const clamp = (x) => Math.max(1, Math.min(5, Math.round(Number(x) || 1)))
const idNum = (s, prefix) => {
  const m = String(s || '').match(new RegExp(`${prefix}-?(\\d+)`))
  return m ? Number(m[1]) : null
}
const pad = (n, w) => String(n).padStart(w, '0')

// ---------------------------------------------------------------------------
// schemas
const SCAN = {
  type: 'object',
  properties: {
    openVentureDecisions: { type: 'integer', description: 'app: meet entries with status OPEN whose title names a V-id or a venture' },
    openTitles: { type: 'array', items: { type: 'string' } },
    nextDecisionId: { type: 'string', description: 'highest D-id in loop/decisions.md + 1, e.g. D-008' },
    nextVentureId: { type: 'string', description: 'highest V-id in loop/ventures.md + 1, e.g. V-17' },
    openBacklogTasks: { type: 'integer', description: 'number of "- [ ]" lines in loop/backlog-meet.md' },
    autonomy: { type: 'string', enum: ['L0', 'L1', 'L2'], description: 'from an ANSWERED/APPROVED MEET-4 decision; L0 if none' },
    runStamp: { type: 'string', description: 'output of: date -u +%Y-%m-%dT%H:%MZ' },
    pool: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' } },
        required: ['id', 'title', 'status'],
      },
    },
  },
  required: ['openVentureDecisions', 'openTitles', 'nextDecisionId', 'nextVentureId', 'openBacklogTasks', 'autonomy', 'runStamp', 'pool'],
}
const IDEAS = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          pitch: { type: 'string', description: 'one line, user-facing' },
          effort: { type: 'string', enum: ['S', 'M', 'L'], description: 'S = 1 task, M = 2-3 tasks, L = more than 3 tasks or new infra' },
          primitive: { type: 'string', description: 'the exact LiveKit API / primitive it uses' },
          acceptance: { type: 'string', description: 'one automatable check: what the e2e or unit test asserts' },
          oracle: { type: 'string', enum: ['local', 'cloud', 'local +key', 'cloud +key'] },
          needs: { type: 'string', description: 'grant changes, new npm deps, other ventures, secrets or long-running processes it needs; "none" if none' },
          ventureId: { type: 'string', description: 'the V-id when this re-pitches an existing pool row, else ""' },
        },
        required: ['title', 'pitch', 'effort', 'primitive', 'acceptance', 'oracle', 'needs', 'ventureId'],
      },
    },
  },
  required: ['ideas'],
}
const SCORES = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'integer', minimum: 1, maximum: 5 },
          effort: { type: 'integer', minimum: 1, maximum: 5 },
          risk: { type: 'integer', minimum: 1, maximum: 5 },
          demo: { type: 'integer', minimum: 1, maximum: 5 },
          gate: { type: 'boolean' },
          gateReason: { type: 'string' },
        },
        required: ['key', 'value', 'effort', 'risk', 'demo', 'gate', 'gateReason'],
      },
    },
  },
  required: ['scores'],
}
const QUEUED = {
  type: 'object',
  properties: {
    queued: { type: 'array', items: { type: 'string' }, description: 'decision ids written, in QUEUE order' },
    note: { type: 'string' },
  },
  required: ['queued', 'note'],
}

// ---------------------------------------------------------------------------
// 1. scan
phase('Scan')
const scan = await agent(`${CTX}
You are the SCANNER. Read loop/decisions.md, loop/ventures.md, loop/backlog-meet.md and report, changing nothing:
- openVentureDecisions + openTitles: "app: meet" entries with status OPEN that propose a venture (title names a V-id, e.g. "Build V-02 ..."). Setup questions such as MEET-1..7 do not count.
- nextDecisionId: the highest D-id in loop/decisions.md + 1 (D-001 if there are none).
- nextVentureId: the highest V-id in loop/ventures.md + 1.
- openBacklogTasks: the number of "- [ ]" lines in loop/backlog-meet.md.
- autonomy: the level chosen in an ANSWERED/APPROVED MEET-4 decision (L0, L1 or L2); L0 if there is none.
- runStamp: run date -u +%Y-%m-%dT%H:%MZ.
- pool: every row of the ventures.md pool table as {id, title, status}, with the status exactly as written.`,
  { label: 'scan', phase: 'Scan', schema: SCAN, effort: 'low' })
if (!scan) {
  log('the scanner returned nothing; stopping')
  return { skipped: true, reason: 'scanner returned nothing', top: [] }
}
const AUTONOMY = ['L0', 'L1', 'L2'].includes(A.autonomy) ? A.autonomy : scan.autonomy
log(`open venture decisions ${scan.openVentureDecisions}/${WIP}, open meet tasks ${scan.openBacklogTasks}, autonomy ${AUTONOMY}`)
if (scan.openVentureDecisions >= WIP && !FORCE) {
  log(`WIP cap: ${scan.openVentureDecisions} venture decisions already wait for the holder; skipping (pass force:true to override)`)
  return { skipped: true, reason: `WIP cap: ${scan.openVentureDecisions} OPEN venture decisions`, open: scan.openTitles, top: [] }
}
const SLOTS = FORCE ? TOP : Math.min(TOP, WIP - scan.openVentureDecisions)
if (SLOTS < TOP) log(`only ${SLOTS} slot(s) free under the WIP cap; queueing at most ${SLOTS}`)

const poolById = new Map(scan.pool.map((p) => [p.id.trim(), p]))
const poolByTitle = new Map(scan.pool.map((p) => [norm(p.title), p.id.trim()]))
const pitchable = (p) => /^pool\b/i.test(p.status.trim()) && !/cooldown/i.test(p.status)

// ---------------------------------------------------------------------------
// 2. propose: 4 lenses in parallel (barrier: dedupe needs every idea)
phase('Propose')
const LENSES = [
  { key: 'U', name: 'user value', ask: 'What does a 3-10 person team miss most after a week of daily standups?' },
  { key: 'D', name: 'differentiator', ask: 'What makes this more than another Meet clone?' },
  { key: 'C', name: 'cheapest on LiveKit', ask: 'What can ship in 1 task using only the primitives we already install (participant attributes, data packets, text streams, RPC)?' },
  { key: 'W', name: 'wow-demo', ask: 'What makes a live audience react within 30 s on a projector?' },
]
const proposed = await parallel(LENSES.map((l) => () => agent(`${CTX}
You are the "${l.key} · ${l.name}" PROPOSER. Your question: "${l.ask}"
Read specs/meet.md (v0 scope and section 3: lenses, gates, rubric), loop/ventures.md (pool and statuses), loop/decisions.md (what is queued or answered), the current apps/meet code if it exists, and the last 50 meet ledger lines (grep '"app":"meet"' loop/ledger.jsonl | tail -n 50).
Return 2-3 candidates:
- Re-pitching an existing row whose status is plain "pool" is allowed and counts as one more vote: set ventureId to its V-id and keep its title. Never re-pitch rows that are queued, approved, built, rejected or in cooldown.
- A new idea has ventureId "" and must not duplicate a pool row, or a v0 prefab feature (chat, screen share, layouts, device menus) as it is.
- primitive: a real LiveKit API that exists in the published packages (check the type definitions in apps/meet/node_modules if installed), named exactly.
- acceptance: one automatable check, either a Playwright two-party E2E against the local dev server or a unit test. "A human looks at it" is not an oracle.
- oracle: local | cloud | local +key | cloud +key (+key = it needs a new human-provided third-party secret).
- needs: grant changes (MEET-AC-02), new npm deps, other ventures (V-ids), secrets, long-running processes; "none" if none.
Do not edit any file.`, { label: `propose ${l.key} ${l.name}`, phase: 'Propose', schema: IDEAS })))

const byKey = new Map()
let raw = 0
let dropped = 0
proposed.forEach((r, k) => {
  if (!r) return
  for (const idea of r.ideas) {
    raw++
    // a V-id counts only if that row really exists; a made-up one falls back to a title match, else it is a new idea
    const claimed = isVid(idea.ventureId) && poolById.has(idea.ventureId.trim()) ? idea.ventureId.trim() : ''
    const vid = claimed || poolByTitle.get(norm(idea.title)) || ''
    if (vid && poolById.has(vid) && !pitchable(poolById.get(vid))) { dropped++; continue }
    const key = vid || norm(idea.title)
    if (!key) { dropped++; continue }
    const seen = byKey.get(key)
    if (seen) {
      seen.votes++
      if (!seen.lenses.includes(LENSES[k].key)) seen.lenses.push(LENSES[k].key)
      continue
    }
    byKey.set(key, { ...idea, ventureId: vid, lenses: [LENSES[k].key], votes: 1 })
  }
})
const candidates = [...byKey.values()].map((c, k) => ({ ...c, key: `C${k + 1}` }))
log(`proposed ${raw} ideas from ${proposed.filter(Boolean).length}/4 lenses -> ${candidates.length} unique candidates (${dropped} dropped: not pitchable or empty)`)
if (!candidates.length) return { skipped: true, reason: 'no candidates', top: [] }

// ---------------------------------------------------------------------------
// 3. judge: 3 independent judges score every candidate
phase('Judge')
const JUDGES = [
  { key: 'product', view: 'the product owner of a 3-10 person team; you weigh Value hardest' },
  { key: 'engineer', view: 'the engineer who must build it in this repo; you weigh Effort and Risk hardest, and you check that the primitive really exists (the type definitions in apps/meet/node_modules/livekit-* and @livekit/* if installed)' },
  { key: 'demo', view: 'the host of the live demo session; you weigh Demo-ability hardest' },
]
const brief = candidates.map((c) => ({ key: c.key, ventureId: c.ventureId || '(new)', title: c.title, pitch: c.pitch, size: c.effort, primitive: c.primitive, acceptance: c.acceptance, oracle: c.oracle, votes: c.votes }))
const judged = await parallel(JUDGES.map((j) => () => agent(`${CTX}
You are judge "${j.key}": ${j.view}. Score EVERY candidate on your own; you do not see the other judges.
Rubric (specs/meet.md section 3), each 1-5:
- value (small team): 1 nice-to-have, rarely used · 3 used weekly · 5 used in every meeting
- effort (INVERSE, higher = cheaper): 1 = L, more than 3 tasks, new infra or secrets · 3 = M, 2-3 tasks · 5 = S, 1 task with existing deps
- risk (INVERSE, higher = safer): 1 = cloud-only oracle plus a third-party secret, or flaky media · 3 = one assertion needs Cloud · 5 = fully provable on the local dev server
- demo: 1 invisible to the audience · 3 visible but needs explaining · 5 obvious on a projector within 30 s
gate = true only if ALL hold: it names a real LiveKit API/primitive; it has an automatable oracle; it does not duplicate a v0 prefab feature as it is; if it needs a new human secret, its oracle says +key. gateReason: "" when it passes, else the gate that fails.
You may read specs/meet.md, loop/ventures.md and apps/meet to check primitives. Do not edit files.
Return one score per candidate key, for every key.
CANDIDATES:
${JSON.stringify(brief, null, 1)}`, { label: `judge ${j.key}`, phase: 'Judge', schema: SCORES })))

const panels = judged.filter(Boolean)
if (!panels.length) {
  log('no judge returned scores; stopping')
  return { skipped: true, reason: 'no judge returned', top: [] }
}
if (panels.length < JUDGES.length) log(`only ${panels.length}/${JUDGES.length} judges returned; medians use those`)

const scored = candidates.map((c) => {
  const s = panels.map((p) => p.scores.find((x) => x.key === c.key)).filter(Boolean)
  if (!s.length) return null
  const score = {
    value: median(s.map((x) => clamp(x.value))),
    effort: median(s.map((x) => clamp(x.effort))),
    risk: median(s.map((x) => clamp(x.risk))),
    demo: median(s.map((x) => clamp(x.demo))),
  }
  const total = score.value + score.effort + score.risk + score.demo
  const gatePass = s.filter((x) => x.gate).length * 2 > s.length
  const gateReason = gatePass ? '' : (s.find((x) => !x.gate) || {}).gateReason || 'gate failed'
  return { ...c, score, total, gatePass, gateReason, judges: s.length }
}).filter(Boolean)

const eligible = scored
  .filter((c) => c.gatePass && c.total >= MIN_TOTAL)
  .sort((a, b) => (b.total - a.total) || (b.score.effort - a.score.effort) || (b.score.risk - a.score.risk) || (b.votes - a.votes))
const top = eligible.slice(0, SLOTS)
log(`scored ${scored.length}: ${scored.filter((c) => !c.gatePass).length} failed a gate, ${scored.filter((c) => c.gatePass && c.total < MIN_TOTAL).length} below ${MIN_TOTAL}/20, ${eligible.length} eligible; queueing ${top.length}${eligible.length > top.length ? ` (${eligible.length - top.length} eligible left in the pool)` : ''}`)

// ids are assigned here, so the queue step is deterministic
let nextD = idNum(scan.nextDecisionId, 'D') || 1
let nextV = idNum(scan.nextVentureId, 'V') || (scan.pool.length + 1)
const vw = Math.max(2, String(nextV + scored.length).length)
for (const c of scored) {
  c.newRow = !c.ventureId && c.gatePass
  if (c.newRow) c.ventureId = `V-${pad(nextV++, vw)}`
}
const autoRule = (c) => (AUTONOMY === 'L2' ? c.total >= 14
  : AUTONOMY === 'L1' ? (c.effort === 'S' && c.oracle === 'local' && c.total >= 16) : false)
for (const c of top) {
  c.decisionId = `D-${pad(nextD++, 3)}`
  c.autoApprove = autoRule(c)
}
if (!top.length) {
  log('nothing reached the queue; the scoring log still records this run')
}

// ---------------------------------------------------------------------------
// 4. queue
phase('Queue')
const row = (c) => ({
  decisionId: c.decisionId || '-', ventureId: c.ventureId || '-', newRow: !!c.newRow, title: c.title, pitch: c.pitch,
  primitive: c.primitive, lens: c.lenses.join(' '), size: c.effort, oracle: c.oracle, acceptance: c.acceptance, needs: c.needs || 'none',
  score: c.score, total: c.total, gate: c.gatePass ? 'pass' : `fail: ${c.gateReason}`, votes: c.votes, autoApprove: !!c.autoApprove,
})
const queuedRes = await agent(`${CTX}
You are the QUEUER (run ${scan.runStamp}, autonomy ${AUTONOMY}). Apply exactly this result; do not re-judge.
0. Ids: use the given decisionIds. Only if one of them already exists in loop/decisions.md (another loop wrote meanwhile), shift ALL of yours, in order, to the next free D-ids, and use the shifted ids everywhere below.
1. loop/decisions.md: for each QUEUE item append an entry in the file's format, like the example in specs/meet.md section 3:
   ## <decisionId> · Build <ventureId> <title>?
   - app: meet | status: OPEN   (APPROVED instead when autoApprove is true)
   - context: score <total>/20 (value v, effort e, risk r, demo d); primitive: ...; oracle: ...; size: ...; acceptance: ...; needs: ...; lenses: ...; votes: n. If the oracle has +key, add "needs a new human-provided secret: <which>".
   - options: A) APPROVED, build now  B) PARKED, keep in pool  C) REJECTED, drop
   - recommendation: A or B, with a one-line why
   - answer: _(loop holder writes here)_   (when autoApprove: "auto-approved at ${AUTONOMY} by ideate; the holder can veto by setting REJECTED")
2. loop/ventures.md: QUEUE items with newRow=false get status "queued (<decisionId>)"; every item with newRow=true (QUEUE or SCORED) gets a new pool-table row with its given V-id, filling all 10 columns of the existing table: ID | Title | One-line pitch | LiveKit primitive | Lens | Effort | Oracle | Oracle assertion (= acceptance) | Needs | Status, with status "queued (<decisionId>)" if it is in QUEUE, else "pool". Never put a "|" inside a cell. Then lower every "pool (cooldown N)" by one ("pool" when it reaches 0).
3. Append one row per SCORED item to the scoring-log table: | ${scan.runStamp} | V-id | value | effort | risk | demo | total | gate | queued as (D-id or -) | note |
4. For each QUEUE item: \`loop/log-event.sh venture meet <decisionId> decision_needed "<ventureId> <title> <total>/20"\`; for autoApprove items also \`loop/log-event.sh venture meet <decisionId> decision_answered "auto-approved ${AUTONOMY}"\`.
5. git add loop/decisions.md loop/ventures.md loop/ledger.jsonl && git commit -m "loop(ideate): queue <decision ids or 'none'> (run ${scan.runStamp})"
Write no app code, never edit the backlog, never approve anything not marked autoApprove.
QUEUE:
${JSON.stringify(top.map(row), null, 1)}
SCORED (every candidate of this run, QUEUE included):
${JSON.stringify(scored.map(row), null, 1)}`, { label: 'queue decisions', phase: 'Queue', schema: QUEUED })

if (!queuedRes) log('the queuer returned nothing: check loop/decisions.md and git status by hand')
if (queuedRes && queuedRes.queued.length === top.length) {
  top.forEach((c, k) => {
    if (queuedRes.queued[k] && queuedRes.queued[k] !== c.decisionId) {
      log(`${c.decisionId} was taken meanwhile; the queuer wrote ${queuedRes.queued[k]}`)
      c.decisionId = queuedRes.queued[k]
    }
  })
}
const result = top.map((c) => ({
  decision: c.decisionId, venture: c.ventureId, title: c.title, total: c.total, score: c.score,
  size: c.effort, oracle: c.oracle, lenses: c.lenses, autoApproved: !!c.autoApprove,
}))
log(`queued for the loop holder: ${result.map((r) => `${r.decision} ${r.venture} ${r.title} ${r.total}/20${r.autoApproved ? ' (auto)' : ''}`).join(' | ') || 'none'}`)
return { skipped: false, run: scan.runStamp, autonomy: AUTONOMY, top: result, scored: scored.length, eligible: eligible.length, written: queuedRes ? queuedRes.queued : [] }
