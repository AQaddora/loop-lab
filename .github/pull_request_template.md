<!--
Read CONTRIBUTING.md first. One task per PR. Fill every section; write "none" rather than deleting one.
Once the production loop runs, a merge deploys to production (D-023), so the loop holder reviews every PR (D-024).
Never paste a secret, a real server name, an IP address or a personal email here.
-->

## Brief

Task: <!-- issue #, backlog id (e.g. T21), or decision id (e.g. D-025) -->

| Box | This task |
|---|---|
| Outcome | <!-- one observable result, e.g. "the CSV export escapes a leading tab" --> |
| Check | <!-- the command that failed before this change and passes after it --> |
| Boundary | <!-- the files the agent was allowed to edit; what it had to leave alone --> |
| Evidence | <!-- what this PR shows below, for one commit --> |

## Evidence for one commit

Commit: `<!-- git rev-parse --short HEAD, the exact commit you pushed -->`

Run from the repo root, on that commit. Status is one of PASS (criteria and evidence complete), FAIL (a criterion
or required evidence is missing), ERROR (the check could not run), SKIP (does not apply; say why).

| Check | Command | Status | Note |
|---|---|---|---|
| Task check | `<!-- the Check command from the brief -->` | | |
| Secret scan | `bash loop/checks/secret-scan.sh` | | |
| Gate: lint + typecheck + unit | `npm --prefix apps/attendance run check` | | |
| AC coverage, no skipped tests | `bash apps/attendance/scripts/check-ac-coverage.sh` | | |
| E2E | `npm --prefix apps/attendance run e2e` | | |
| Prod build has no test mode | `bash apps/attendance/scripts/check-prod-no-test-mode.sh` | | |

Did the task check fail before the change? <!-- yes, with this output: ... -->

## Stopping point

Repair attempts used: <!-- 0, 1 or 2 (the budget is 2) -->

<!-- If you stopped at the budget: what still fails, the exact output, what you tried, your best diagnosis.
Open the PR as a draft, or add a decision entry, instead of loosening a check. -->

## Not verified

<!-- What this evidence does not cover. Examples: real Google sign-in and a real phone passkey (the oracle uses
stand-ins, spec §7.5); behaviour on the deployed origin (AC-39 and the production observer check it after release);
browsers other than Chromium. -->

## Checklist

- [ ] One task only: a `loop-task` issue, an exercise or an answered decision. Not T16, a P-task (the production
      loop's) or an M-task (the holder stopped meet), unless an issue hands it to me. No drive-by refactors.
- [ ] No test was deleted, skipped (`.skip` `.only` `.fixme` `xit` `test.todo`) or weakened.
- [ ] Nothing under `specs/` changed, and no acceptance criterion or `done when` line changed.
- [ ] Test-only code sits behind `isTestMode()` (CLAUDE.md rule 5).
- [ ] This PR does not change the oracle (`.github/workflows/`, `apps/attendance/scripts/`, `playwright.config.ts`,
      `vitest.config.ts`, `loop/checks/`, `loop/hooks/`), or it says here which lines changed and why.
- [ ] `loop/ledger.jsonl` is unchanged, unless the issue asks for it (`git restore --staged --worktree loop/ledger.jsonl`).
- [ ] No secret, real server name, IP address or personal email in the diff or this description.
- [ ] Questions for the holder are decision entries in `loop/decisions.md`, not comments in chat.
