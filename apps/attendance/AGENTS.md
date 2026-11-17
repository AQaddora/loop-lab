<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Lessons from production (specs/prod-loop.md 4.4)

- 2026-11-17 · D-025 · What happened: the loop's first deploy re-shipped `feeb435`, which a bootstrap deploy had already made live; Dokku answered "No changes detected" with exit 1, and `ship.sh` called the release red and paused production. Rule: a deploy tool's non-zero exit is red unless the tool says it did nothing *and* the live system is checked to be exactly what was asked (every running web container has the requested image's layers); the health and smoke checks still run either way. Why: an exit code describes the tool, not production; trusting it alone gives a false red, and trusting the tool's "no changes" alone would give a false green. Checked by: `tests/deploy/ship.test.sh` section 18 (the no-op cases fail on the old `ship.sh`).
