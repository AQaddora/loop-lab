#!/usr/bin/env bash
# SessionStart hook. Its stdout is injected into the new session's context, so every fresh
# session (startup, resume, /clear, compaction) "remembers" where the loop is:
# backlog progress, next task per app, OPEN decisions, gate state, last events.
# Must never fail or block a session: always exit 0.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

input=$(cat 2>/dev/null || true)
source=$(printf '%s' "$input" | jq -r '.source // "startup"' 2>/dev/null || echo startup)
[ -n "$source" ] || source=startup

"$ROOT/loop/observe.sh" brief 2>/dev/null || echo "## loop-lab: state unavailable (run loop/observe.sh summary)"
# log only real hook runs (Claude Code sends JSON on stdin); a manual `session-start.sh </dev/null` is a preview, not a session
if [ -n "$input" ]; then
  "$ROOT/loop/log-event.sh" inner lab - session_start "$source" >/dev/null 2>&1 || true
fi
exit 0
