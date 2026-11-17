# History: every human interaction

On 2026-11-17, during the live workshop "The Loop in Practice" (AI Talent Lab, TAQAT), agent loops built the attendance
app in this repo while the loop holder, Ahmed Qaddoura, stayed on the loop, not in it. He then asked to "make the repo
public with the history of every interaction human had made", for the trainees (H14 in 01; decision D-023).
This folder is that history, as far as three Claude Code sessions recorded it: what the human typed, chose or
approved, what the agents ran on his behalf, what he decided, and when each thing happened.

## Files

| File | What is in it |
|---|---|
| [01-human-prompts.md](01-human-prompts.md) | all 23 human interactions in order, verbatim, each with what it led to |
| [02-prepared-prompts.md](02-prepared-prompts.md) | the prompts the orchestrator wrote and dispatched for the holder, and what came of each |
| [03-decisions.md](03-decisions.md) | every decision in `loop/decisions.md` and every answer given in chat; D-023 is the closing one |
| [04-timeline.md](04-timeline.md) | one merged timeline: human messages, workflow runs, merges, decisions, deploy steps |
| [prompts/](prompts/) | copies of the prompts: the scaffold workflow script and the two loop briefs |
| [data/human-messages.jsonl](data/human-messages.jsonl) | the extractor's output behind 01, one JSON object per interaction |
| [tools/extract_human_log.py](tools/extract_human_log.py) | the extractor that produces it |

## How to read it with the lecture

- **Requester:** the holder. He made 23 interactions all day; 16 were typed messages, and the longest was the first.
- **Implementer:** the agents. A scaffold workflow wrote the specs and the loop harness, and a build-loop session built the app.
- **Reviewer:** adversarial reviewer agents and the test oracle first. From now on, the holder is the last reviewer of every trainee PR (D-024).
- **The five stations:** Task (specs, backlogs and briefs: [02](02-prepared-prompts.md)), Agent (the build loop),
  Review (three review lenses and the oracle), Deploy (T16 and the production loop, not done at the snapshot) and
  Lesson (`specs/prod-loop.md` §4.4). The build loop covered the first three. D-023 opened the last two.
- **Stopping point and repair budget:** the Stop gate gives up after 3 retries and the feature loop after 2 fix rounds
  (LOOPS.md). The production brief allows 2 repair attempts per failing check.

## Sources

| Source | What it gave |
|---|---|
| Transcript of the orchestrator session, titled "Loop practice project brainstorm" (`4132b77d….jsonl`, from 11:16 UTC) | the holder's messages, answers, card choices and approvals; the prompts it dispatched; the times of its actions |
| Transcript of the build-loop session, "Attendance build loop (T01 onward)" (`d730bc40….jsonl`, from 11:48 UTC) | the brief as received, and the holder's messages to it from 21:20 UTC |
| Transcript of its side session, "btw: open it on my mac" (`9398ee2d….jsonl`, forked at 11:49 UTC) | one side question |
| The scaffold workflow's script and run record (run `wf_6316037a-16a`) | the seven agent prompts; each agent's start, end and tool calls; what each reviewer fixed |
| The showcase page the orchestrator published (a private Claude artifact, "Loop Lab Live") | copies of the briefs and the repeat commands as shown on stage |
| `loop/decisions.md`, `loop/ledger.jsonl`, `git log` | statuses, answers, merges and event times |
| The English slide text of the workshop, read from the lecture page | vocabulary only |

The transcripts are Claude Code session files (JSONL, one JSON object per line). They are not published: they hold
secret values and private server names. Other sessions on the same machine that are not about loop-lab are not included.

The holder also gave instructions to the fleet on Telegram. His own messages refer to them: "I asked telegram to make
the repo public ..." and "i asked telegram for social media video" (H14), and "i told telegram" (H18). Those Telegram
messages are not in these transcripts. They are not included here and are not verified.

## Method

1. **What counts as a human interaction.** In a transcript, an entry of type `user` whose `origin.kind` is `human`
   (a typed message); a `queued_command` attachment from a human (a message typed while the agent was working; the
   older form inside a tool result, "The user sent a new message while you were working:", is read too); the answers
   in an AskUserQuestion result; the choice on a session card ("The user chose …"); and an approved computer-use dialog.
   Tool results, `<system-reminder>` text, compaction summaries, skill bodies, task notifications and the briefs one
   session sends another are not human input and are skipped.
2. **Deduplicate.** A compacted or forked transcript can repeat entries. Each interaction counts once: by its entry id,
   and by its text within one session.
3. **Order.** By UTC time, then by session and line.
4. **Snapshot.** Entries after 2026-11-17 21:51:21 UTC are left out (`--until`), so a re-run gives the same list.
5. **The "Led to" lines** in 01 and all of 02, 03 and 04 were written by hand from the sources above. Each claim names a
   commit, a decision id, a ledger event or a transcript time. What could not be checked is left out or marked as not verified.

## Publication rules

The holder asked for this at 21:17 UTC: "make the repo paths different from my servers". So every file here uses
public aliases instead of real server names. The extractor applies them, and the hand-written files use the same ones.

| Written here | Stands for |
|---|---|
| `loop-runner` | the box the loops ran on |
| `apps-host` | the TAQAT box that runs the Dokku apps behind apps.taqat.academy |
| `<tailnet>` | the private tailnet name, as in `loop-runner.<tailnet>.ts.net` |
| `~` | the home directory on loop-runner |
| `<you>` | a Unix user name on the boxes |
| `<fleet-state>` | the fleet's own state directories |
| `<fleet box>` | another box of the fleet |
| `<scratchpad>` | the agent's temporary folder |
| `<ip omitted>` | the IP address of a real machine (loopback, documentation addresses and private ranges written as CIDR blocks are kept) |
| `<tailscale admin link omitted>`, `<node id omitted>` | a Tailscale login link or node id |
| `<owner's Google account>` | a personal e-mail address |
| `<owner's Google project>` | the name of the Google Cloud project that holds the OAuth client (H16 has one) |
| `<LiveKit project host>` | the host of the LiveKit Cloud project URL (the project name, test-loops, is kept) |
| `[redacted]` | a secret value, or a 16-character piece of one; also an OAuth code or token inside a pasted URL (H23 has one) |
| `[attached: …; not published]` | a file the holder attached; the file itself is not published |

Secret values are never written here. The extractor loads every value in the host-local secret store
(`~/.config/loop-lab/secrets/*.env`) and replaces each one it finds. The store itself stays on loop-runner.
It also replaces credentials the store does not hold: URL parameters such as `code=`, `state=` and `token=`,
bearer tokens and JWTs.

## Re-run the extractor

Run it on loop-runner. It reads three things from the box it runs on: the home directory, the user name and the host
name (they become `~`, `<you>` and `loop-runner`). Every other private name comes from a private alias file that you keep
outside the repo: one `private name<TAB>public alias` pair per line, `#` for comments.

```sh
P=~/.claude/projects/<project>            # where Claude Code keeps the transcripts
python3 -I docs/history/tools/extract_human_log.py \
  --aliases ~/.config/loop-lab/publication-aliases.tsv \
  --until 2026-11-17T21:51:21Z \
  orchestrator=$P/4132b77d-<rest of id>.jsonl \
  build-loop=$P/d730bc40-<rest of id>.jsonl \
  side=$P/9398ee2d-<rest of id>.jsonl > /tmp/human-messages.jsonl
diff /tmp/human-messages.jsonl docs/history/data/human-messages.jsonl   # no output means the same result
```

Other modes:

- `--format md` prints the quotes in the form used in 01.
- `--prepared` prints the prompts the sessions dispatched (session briefs and proposals, workflow launches, subagents).
- `--sanitize-file FILE` prints one file with the same rules applied. That is how `prompts/scaffold-workflow.js` was made.

It imports only the standard library. Run it with `python3 -I`, so nothing from the current folder is imported.
Without `--aliases` it warns and applies only the built-in rules; read the output before you publish it.
For the three transcripts above, the output is the same with or without the alias file.

## Checks on this folder

Before publication, a script read every file in this folder and counted:

| Check | Found |
|---|---|
| a value from the secret store, or any 16-character piece of one | 0 |
| a private server name, user name, home path, fleet path or tailnet name from the alias map | 0 |
| an IP address of a real machine | 0 |
| an e-mail address (other than placeholder ones such as `you@example.com`) | 0 |
| the name of the owner's Google Cloud project | 0 |
| a credential from a pasted URL (the OAuth code in H23) | 0 |

The script printed only the names of the checks and the counts, never a value.

## Note on two commit ids

Before the first push, two unpushed commits from the tailnet-mirror work were rewritten so that the public history holds no fleet identifiers. Only test fixture values changed: a real tailnet IP and a real host name in two unit tests. `7f29e7c` became `115f117` and `1a69c9f` became `30b656e`. Older ledger lines still name the old ids. A ledger `fixed` event at 22:09 UTC records the mapping.
