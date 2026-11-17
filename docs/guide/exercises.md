# Exercises

The workshop's exit task: "Write your next task, the proof you need, and a stopping condition."
Each exercise below already has that shape:

- **one small task**,
- **evidence tied to a criterion** (an AC, a threat id, a decision, or a command's output for one commit),
- **a clear stopping condition**.

Do them with your agent, on your fork. Start every exercise from a green baseline
(`npm --prefix apps/attendance run check`), and name the commit sha in your evidence.
The repair budget is the same everywhere: **two attempts**, then stop with a diagnosis. Never loosen a check to finish.

| # | Exercise | Station | Takes |
|---|---|---|---|
| 1 | Run the oracle and classify every result | Review | 20 min |
| 2 | Answer an OPEN decision with reasons | Task | 20 min |
| 3 | Write a test for a threat in the threat table | Agent, Review | 30 min |
| 4 | Add a production observer check | Deploy | 40 min |
| 5 | Turn a vague request into a brief | Task | 15 min |
| 6 | Accept a specific version | Review | 20 min |
| 7 | Turn a ledger failure into a lesson | Lesson | 15 min |
| 8 | Review a change to the oracle itself | Review | 15 min |

The times are rough guides, not measurements.

---

## 1. Run the oracle and classify every result

**Task.** Run the five checks from `CONTRIBUTING.md` §5 on one commit, and give each one a status: PASS, FAIL, ERROR or
SKIP. Then make one check ERROR on purpose: start anything on port 3100 (for example `python3 -m http.server 3100`) and
run `npm --prefix apps/attendance run e2e` again.

**Evidence.** A table: check, exact command, status, and the one output line that justifies the status. The sha on top.
For the port case, explain in one sentence why it is ERROR and not FAIL. The trainer's notes put it this way:
"A browser that cannot start is ERROR."

**Stop when** the table is complete. Change no code. The secret scan (`loop/checks/secret-scan.sh`, PR-07) needs
only git and python3. If the commit you test does not have it, that row is ERROR: the check applies, but it could not
run. Say so in the note.

## 2. Answer an OPEN decision with reasons

**Task.** Pick one `status: OPEN` entry in `loop/decisions.md`: D-008, D-012, D-013, D-016 or D-017 are good ones.
Write the answer you would give if you were the loop holder.

**Evidence.** In the decision's own format: the option you pick, two reasons, and for each reason the spec line or
threat id it rests on (for example "TH-20 stays High until …"). Name the test or backlog task your answer would add.
Post it as an issue with the **Decision answer** template, and link the entry.

**Stop when** you have one answer of at most ten lines. Do not edit `status:` or `answer:`: only the holder does.
If you cannot choose without information you do not have, say what that information is. That is a valid answer.

## 3. Write a test for a threat in the threat table

**Task.** Pick a row in `specs/attendance.md` §3 (TH-01 … TH-25). List its mitigation clauses. For each one, find the
test that covers it (`grep -rn "AC-30" apps/attendance/e2e apps/attendance/tests`). Pick one clause with no test, and
write that test.

A worked starting point: TH-23 (CSV formula injection) says cells starting with `=`, `+`, `-`, `@`, a tab or a CR are
escaped. The AC-30 E2E test checks `=`. `src/lib/csv.ts` has `csvCell()` and no unit test.

**Evidence.**

1. Before: the check fails because the test does not exist yet (`npm --prefix apps/attendance test -- tests/unit/csv.test.ts`).
2. After: it passes.
3. Proof that the test can fail: break the code on purpose (drop `\t` from the regex in `csvCell()`), run the test,
   show it red, then restore the code. A test that stays green when the code is broken proves nothing.

**Stop when** the three runs are recorded. If the new test fails on the unchanged code, you found a real gap: stop,
and open a decision (or a private report, if it lets someone cheat: `SECURITY.md`). Do not fix the app in the same PR
unless your brief said so.

## 4. Add a production observer check

**Task.** The production observer (`specs/prod-loop.md` §4.3, task P03) is designed to run O1 … O7 after release.
None of them re-checks the security headers: AC-38 checks `Referrer-Policy` and the CSP in CI, and AC-39 checks HSTS
once, at deploy time. Write a small script,
`loop/checks/headers-check.sh <base-url>`, that checks `Referrer-Policy: no-referrer`, a CSP containing
`frame-ancestors 'none'`, and HSTS. It prints one line per header and exits 0 (all PASS), 1 (any FAIL) or 2 (ERROR:
the URL could not be reached).

**Evidence.** Its output against your local test server (`npm --prefix apps/attendance run dev:test`, then
`http://localhost:3100`). HSTS is sent in production only, so locally it must report SKIP with that reason, not FAIL.
Also show the ERROR exit code against a port where nothing listens. Then propose it as O8 in a decision entry: the spec
is the holder's to change.

**Stop when** the script gives the right status in those three cases. Run it against your local server only. The
production loop would run it against the live origin, once the holder accepts it and the observer exists.

## 5. Turn a vague request into a brief

**Task.** Take the request "make the kiosk more secure" and write a brief with the four boxes from `CONTRIBUTING.md` §3:
outcome, check, boundary, evidence. It must name one AC or threat id (TH-15 is the kiosk row).

**Evidence.** Give the brief to a partner. They must be able to say how they would judge the result, without asking you
anything.

**Stop when** your partner can judge it. If they ask one question, revise once. If they still have a question, the task
is too big: split it and keep the smaller half.

## 6. Accept a specific version

**Task.** Act as the requester for one commit on `main`. Pick one, for example the sha in the last `deployed` event in
`loop/ledger.jsonl` (if there is one yet), or the newest `loop(...)` commit. Check it out in a separate worktree
(`git worktree add ../accept <sha>`), install, and run the five checks there.

**Evidence.** The evidence table, with that sha at the top. Then a decision: accept, more evidence, or a specific
repair, with two reasons and one remaining limit. The workshop: "Evidence identifies the same version."

**Stop when** you have decided. If a check cannot run on that commit, for example because the files it needs did not
exist yet (`git log --diff-filter=A --format=%h -- specs/attendance.md` shows when the spec was added), that check is
ERROR, not FAIL. Remove the worktree afterwards (`git worktree remove ../accept`).

## 7. Turn a ledger failure into a lesson

**Task.** Find where the loop struggled:

```bash
jq -s 'map(select(.event=="test_fail" or .event=="review_fail")) | group_by(.task) | map({task: .[0].task, n: length})' loop/ledger.jsonl
```

Pick one event and read the `fixed` event that follows it, then the task's commit. Answer the workshop's four lesson
questions: what happened, what rule helps and why, where it will be read or enforced, and how it will be checked next time.

**Evidence.** The ledger line (time, task, detail), the commit sha, and your rule as one line in the format
`specs/prod-loop.md` §4.4 asks for in `apps/attendance/AGENTS.md`. Name the check that enforces it, or say that none
exists yet.

**Stop when** you have one rule of one line with its reason. A list of rules is not a lesson.

## 8. Review a change to the oracle itself

**Task.** In T12, the ledger says the fix included "e2e timeout 60 s for multi-context WebAuthn tests". Read the change:
`git show 433ea51 -- apps/attendance/playwright.config.ts`. Decide whether it weakens the oracle.

**Evidence.** The diff lines, the ledger lines for T12, and what spec §6.3 pins for the E2E config (workers, retries,
`forbidOnly`, trace). Your verdict: accept, more evidence, or repair, with the reason. The trainer's notes ask AI students
"whether tests changed". Ask it here, and then: does the changed test still check the same criterion?

**Stop when** you have a verdict of at most five lines. If you think the change hid a defect, open a decision. Do not
revert it yourself.
