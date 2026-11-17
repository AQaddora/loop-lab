# The Loop, live: what we built while the theory was on screen

*By Ahmed Qaddoura (The Builder), with the loop orchestrator · 17 November 2026*

This is the practice half of **"The Loop in Practice: From Task to Trusted Results"** (The Loop عمليًا), the AI Talent Lab bonus workshop: two hours, 15 slides. Mahran Bayed presented the theory; I ran the practice as the loop holder. It is based on my book [*The Loop Explained*](https://aqaddoura.com/library/files/The-Loop-Explained-AR-v0.2.pdf) (Arabic v0.2), and the lecture page is [here](https://mahranbayed.com/ai-talent-lab/?section=the-loop-workshop).

Times are UTC. Numbers come from `git log`, [the ledger](../../loop/ledger.jsonl), [the decisions inbox](../../loop/decisions.md) and [`docs/history/`](../history/). My quotes are as I typed them, typos included.

## While Mahran was on the theory

At 11:16 I was typing into a Claude Code session on loop-runner, the box the loops run on. That session became the loop orchestrator. Near the end of my first message I wrote:

> mahran is currently seaking so we need to act fast // brainstorme with me how can a complete system like the first one and the second one can be done with the minimum involvement from any human.. the loop designer or engineer let's rock it..

At 11:21 a workflow was already writing the project. At 11:46 Mahran was done with the theory, and I asked: "did we dispatch the attendance loops?" At 11:47 I clicked a session card, and the build loop started in its own session.

## The brief I gave

I gave two ideas in one message. The first was an on-site attendance system: scan a QR at the office, sign in with Google, confirm with a fingerprint or Face ID, and only from the office Wi-Fi. In my words: "we need the system not to be manipulated", and "admin must approve new fingerprints via their dashboard". The second was a meeting app on LiveKit Cloud that "will start small and loops keep building it".

By the lecture's brief slide (outcome, check, boundary, evidence), it had an outcome and no checks. The first job was to make it something a machine can judge. We kept both ideas, because they show two kinds of loop: attendance, a closed loop that converges on a spec, and meet, an open loop that a person steers.

## How the loop was designed

[`LOOPS.md`](../../LOOPS.md) says it in one line: the human is **on** the loop (designs it, holds the decisions), not **in** it. A loop runs unattended only if it has six parts:

| Part | In this repo |
|---|---|
| Goal | [`specs/attendance.md`](../../specs/attendance.md) (AC-01 to AC-43) and [the backlog](../../loop/backlog-attendance.md) |
| Act | exactly one backlog task per iteration |
| Check | the task's `done when` command, the full gate, the Stop hook, three review lenses |
| Stop | Stop gate cap of 3, at most 2 fix rounds, at most 20 tasks per run |
| Memory | one git commit per task, the ledger, backlog ticks |
| Escalate | `loop/decisions.md`, the task marked `[!]`, a phone ping |

Three loops nest. **Inner** (minutes): a Stop hook will not let the agent finish while `npm test` is red. **Feature** (hours): `build-next` picks one task, builds it, sends it to three reviewers, fixes at most two rounds, commits and logs. **Venture** (days): agents propose features, judges score them, the holder decides.

A scaffold workflow wrote all of this between 11:21 and 12:19: 7 agents in 58 minutes. The attendance reviewer played a dishonest employee, a dishonest admin and an engineer with no human help. Under that attack the spec grew from 39 to 43 acceptance criteria, and the backlog from 16 to 20 tasks. For example, an admin now approves a new phone by typing a 6-character code that only that phone shows.

## What I did, and what the loop did

What I did as a human, the main acts ([`docs/history/`](../history/) has every one):

- **11:30, the LiveKit keys:** "take it from there safely to the runner". After two approval dialogs, the orchestrator read my Mac clipboard once, stored the keys outside the repo (directory 700, file 600) and checked them live: LiveKit Cloud answered 200.
- **11:36 to 11:38, the Google OAuth client.** I uploaded the JSON ("take it its for demo no worries .."). Stored the same way, checked without a browser: to a fake code Google answered `invalid_grant`, which means the client is valid. Then I added the localhost redirect in Google Console.
- **11:39 to 11:43, the first deploy answer:** I asked for a domain, then settled on a staging path on the tailnet.
- **11:47, the session card** that started the build loop.
- **12:25, I stopped the open loop:** "Stop the meet, no need for open loop". It had built nothing. Five of its seven decisions were parked (the other two were already answered), and the ledger logged the stop.
- **20:13 to 21:42, the evening:** I asked what was on me, and asked for the deploy, the public repo, a video and this blog. I chose the owner's Google account, answered D-023, D-024 and D-002, added the tailnet redirect URL, turned on Tailscale Serve, answered two build-loop questions and reported a sign-in error.

The loop did the rest: it picked tasks, wrote code and tests, reviewed, fixed, committed and logged. When it needed me, it wrote the question down. The orchestrator wrote my answers into the inbox and kept my showcase page current.

## The numbers

- First merge, T01, at 11:54:11. Last merge, T15, at 13:32:27.
- **19 of 20 tasks merged**, one `loop(Txx)` commit each, `1cca1e4` to `5be44a6`. T16, the deploy, is left.
- The oracle at T15: lint, typecheck, 96 unit tests, the AC coverage guard (every AC except AC-39, which needs a deployed server), the production guard, and 74 of 74 end-to-end tests. All PASS.
- At about 20:15 the orchestrator, a different session, re-ran the whole oracle: PASS.
- In the build run, up to 13:34, the ledger has 19 `merged`, 3 `review_fail`, 4 `test_fail` and 7 `fixed`.
- As of the history snapshot at 21:51, [`docs/history/`](../history/) counts 23 interactions from me: 16 typed messages, 4 answers to the agents' questions, one card choice and two approvals.
- 24 decisions in the inbox: 7 answered, 5 parked, 12 open.
- Production deploys in the ledger when I wrote this: 0.

## What the loop caught in its own work

Each of these is a `review_fail` or `test_fail` in the ledger, then `fixed`.

**T07: a guard that could never fire.** The rule about acting on yourself ran before the last-owner guard, so that guard was unreachable. Self-review caught it, and the fix reordered the rules so both error codes can be returned.

**T09: the spec was wrong about Chromium, and the loop measured it.** The spec said how to fake, in tests, a phone that signs without user verification. On Playwright 1.65's Chromium 159 that setup refuses every registration. The loop did not edit the spec. It built the test helper the way Chromium allows, kept the server's checks unchanged, got AC-18 green, and filed D-021 for me to accept.

**T13: 35 red tests that were not product bugs.** Under load, the dev server compiled routes lazily and reloaded open pages mid-test. The fix was not a retry or a longer wait: a global setup compiles every route first. The suite went to 66 of 66.

**T18: the one time it changed its own oracle, and said so.** The revised AC-28 lets IP and user agent be set to NULL for data retention. An older test asserted the opposite, and the backlog said existing tests stay untouched. The loop changed exactly two assertions, added a test for the revised rule (`db-retention.test.ts`), and opened D-020 asking me to accept. D-020 is still open: visible, reasoned, and waiting for a person.

## The evening gap

At 13:34 the loop stopped at T16. It needed three things only I could give: Tailscale Serve turned on, a staging Google redirect (D-004), and an answer on a port clash (D-022).

Then it sat idle. From its final report at 13:35 to my message at 20:13 ("how is it going update my artifact what is on me?"), more than six and a half hours, nobody looked. The ledger has no event between 13:34 and 21:17. Phone pings were off: D-002, the question about them, was unanswered. I turned Serve on at 21:25 for a tailnet mirror and answered two build-loop questions at 21:30; at 21:33 it merged a `loop(lab)` commit for that mirror. T16, now aimed at apps-host, stayed open.

`LOOPS.md` calls this **decision starvation**. The lecture's stopping-point slide asks for "a diagnosis when blocked" and "a named decision owner". The loop had both, but no way to reach the owner. An escalation path that nobody reads is not an escalation path. I answered D-002 in my own words: "let me know when a live link is there on telegram as escelate e.g." The answer: `deployed`, `blocked` and `decision_needed` go through the fleet's Telegram sender, merges do not, so the phone rings only for escalations.

## The last decision: steering

At 20:57 I wrote the last decision of the workshop:

> mark last decision is this steering drifintg the loop into different loop, with production observation building started.. spec that and dispatch it auto deploy to apps.taqat.academy

It is D-023, recorded at 21:17. The build loop had converged; its last task was a deploy. Its oracle stops at "tests are green", and green tests describe a version that never left the build box. Of the lecture's stations, **Task → Agent → Review → Deploy → Lesson**, the build loop covers the first three. The slide "Accept a specific version" ends with "Behavior checked after release". A build oracle cannot check that, because it never sees production.

So I steered. The production loop ([spec](../../specs/prod-loop.md), [backlog](../../loop/backlog-prod.md)) has a different oracle, production itself. Its spec says:

- **Deploy:** every `main` commit with a green CI oracle goes to <https://attendance.apps.taqat.academy>, a Dokku app on apps-host.
- **Check:** the AC-39 smoke test runs after each deploy. A red smoke rolls back to the previous image and pauses deploys.
- **Observe and escalate:** seven checks every 10 minutes, from spoofed client-IP headers to the log's hash chain. The spec sends anomalies to the inbox and Telegram.
- **Lesson:** when production catches something CI missed, the same task adds the test that would have caught it.

Its tasks are not built yet: P01 to P06 were not ticked when I wrote this. As the spec says: "Steering is a human act: the holder changed what 'done' means. The agents didn't."

The repo is going public, and once the production loop is built, every merge to `main` will auto-deploy. So a merge is a production decision. D-024: a trainee's agent PR needs the CI oracle green **and** my review. The oracle cannot judge intent.

## What shipped within the lecture

- [The attendance spec](../../specs/attendance.md): 43 acceptance criteria after the dishonest-employee attack.
- [The backlog](../../loop/backlog-attendance.md) and its 19 merged tasks.
- The oracle: [the AC coverage guard](../../apps/attendance/scripts/check-ac-coverage.sh), [the production guard](../../apps/attendance/scripts/check-prod-no-test-mode.sh), 96 unit tests and 74 end-to-end tests.
- [The production loop spec](../../specs/prod-loop.md) and [its backlog](../../loop/backlog-prod.md); the loop itself is not built yet.
- [`docs/history/`](../history/): every interaction I had, verbatim apart from aliases and redactions.

Not shipped yet when I wrote this:

- Production target: <https://attendance.apps.taqat.academy>. Not deployed: the ledger has no `deployed` event. On the first one, `loop/log-event.sh` pings my Telegram with the live link (D-002).
- Repo: <https://github.com/AQaddora/loop-lab>. Private since 21:24, until the secret scan passes; public after.

## Try it yourself

Start with [CONTRIBUTING.md](../../CONTRIBUTING.md) and [the exercises](../guide/exercises.md).

Once the repo is public, fork it, open Claude Code in the repo (`CLAUDE.md` holds your agent's rules), and take one small task: a `loop-task` issue or a starter exercise. Write the brief the lecture way: outcome, check, boundary, evidence. Set a stopping point: a repair budget of two attempts, then a diagnosis, never a weaker test. Your PR carries evidence for one specific commit, each check marked PASS, FAIL, ERROR or SKIP. The CI oracle will review it first and I review it last. Once built, the production loop will check its behavior after release.

## Closing

By the history snapshot at 21:51 I had typed 16 messages. The loop did the building. My job was the part a machine cannot do: decide what "done" means, and when to change it.

Take one task. Start your loop.

## بالعربي

بينما كان مهران يشرح الجانب النظري من ورشة «The Loop عمليًا»، كانت الحلقة تُبنى على الهواء مباشرة. أعطيتُ فكرتين بكلمات بسيطة، فكتب سير عمل من 7 وكلاء المواصفات وأدوات الحلقة في 58 دقيقة، ثم دمجت حلقة البناء 19 مهمة من 20 بين 11:54 و13:32 بتوقيت UTC دون أن يلمسها أحد، وكل الاختبارات خضراء. دوري أنا كان تسليم المفاتيح السرية، والإجابة عن القرارات، وإيقاف حلقة الاجتماعات المفتوحة قبل أن تبني أي شيء. والحلو في القصة أن الحلقة اكتشفت أخطاءها بنفسها، وحين لم تستطع أن تقرر، كتبت السؤال وانتظرت بدل أن تخمّن. لكنها بقيت أكثر من ست ساعات ونصف بلا عمل لأن أحدًا لم يُنبَّه، والدرس واضح: التصعيد الذي لا يصل إلى صاحب القرار ليس تصعيدًا. وآخر قرار في الورشة كان التوجيه: نقلتُ الحلقة من حلقة بناء تتوقف عند «الاختبارات خضراء» إلى حلقة إنتاج صُمّمت (حسب مواصفاتها) لتراقب النسخة الشغّالة وتتراجع تلقائيًا إذا فشل فحص ما بعد النشر؛ لم تُبنَ مهامها بعد. خذوا مهمة واحدة، وابدؤوا حلقتكم.
