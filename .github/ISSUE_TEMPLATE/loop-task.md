---
name: Loop task
about: One small task that a trainee and their agent can finish in one PR, with a check that proves it
title: "loop-task: "
labels: loop-task
---

<!--
A task is ready when another person could judge the result without asking you.
Never paste a secret, a real server name, an IP address or a personal email here.
Questions for the loop holder go to a decision entry in loop/decisions.md, not to this thread.
-->

## Outcome

<!-- One observable result. "Improve the CSV export" is not one. "A name that starts with a tab is exported with a leading ' " is. -->

## Check

<!-- The exact command, run from the repo root. It must fail before the work and pass after it. -->

```bash

```

## Boundary

- May edit: <!-- files or folders -->
- Must not edit: `specs/`, acceptance criteria, `done when` lines, existing tests (add new ones instead), `loop/ledger.jsonl`
- Depends on: <!-- backlog ids or issues that must be done first, or "none" -->

## Evidence the PR must carry

- The Check output, for one named commit
- The full oracle table (PASS / FAIL / ERROR / SKIP), as in the PR template
- What remains unverified

## Stopping point

Two repair attempts. Then stop with a diagnosis and open a decision. Never loosen the check.

## Links

<!-- Spec section, AC ids (AC-NN), threat ids (TH-NN), decision ids (D-NNN) -->
