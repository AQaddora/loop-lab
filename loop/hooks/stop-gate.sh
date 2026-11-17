#!/usr/bin/env bash
# Stop hook = the INNER LOOP. The agent may not end its turn while the gated app's tests are red.
#
#   on:   echo attendance > loop/.gate      (file content = app name)
#   off:  rm loop/.gate
#
# Active only if loop/.gate exists AND apps/<app>/package.json exists.
#   green -> log test_pass, exit 0 (agent may stop)
#   red   -> log test_fail, last ~40 lines of output to stderr, exit 2 (Claude keeps working)
#   red more than 3 times in a row -> log blocked, exit 0 (the cap: it can never loop forever)
# It always lets the session stop (exit 0, no test run) when:
#   - a build-next iteration for <app> is in flight (its builder logged start "build-next: ..." and the task's last
#     feature-loop ledger event is start/test_*/review_*/fixed, less than 2 h old): the workflow's builder, fixer and test lens own the tree and run the oracle themselves,
#     so this session must not be pushed into editing code under them;
#   - the tree is unchanged since the last green run (loop/.gate-green), or since the cap was hit on it (loop/.gate-gaveup),
#     so an unattended /loop does not burn 3 forced retries per tick on the same red tree;
#   - the retry counter cannot be written (fail open rather than loop).
# Retry counter: loop/.gate-retries (reset on green, on a new turn, and when the cap is hit).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/loop/.gate"
RETRIES="$ROOT/loop/.gate-retries"
GREEN="$ROOT/loop/.gate-green"
GAVEUP="$ROOT/loop/.gate-gaveup"
LEDGER="$ROOT/loop/ledger.jsonl"
MAX_RETRIES=3
INFLIGHT_MAX_AGE=7200 # seconds since the last feature-loop event of an unfinished task
LOG="$ROOT/loop/log-event.sh"

input=$(cat 2>/dev/null || true)

[ -f "$GATE" ] || exit 0
app=$(head -n1 "$GATE" | tr -d '[:space:]')
case "$app" in attendance|meet) ;; *) exit 0 ;; esac
[ -f "$ROOT/apps/$app/package.json" ] || exit 0

# A new turn (stop_hook_active=false) gets a fresh retry budget.
active=$(printf '%s' "$input" | jq -r 'if type == "object" and has("stop_hook_active") then (.stop_hook_active | tostring) else "missing" end' 2>/dev/null || echo missing)
[ "$active" = "false" ] && rm -f "$RETRIES"

# Defer to a build-next iteration that is mid-task (see header). Only workflow iterations count: their builder logs
# `start "build-next: <title>"`. A session that runs a task by itself still gets the gate.
if [ -s "$LEDGER" ]; then
  inflight=$(tail -n 400 "$LEDGER" 2>/dev/null | jq -R -n -r --arg app "$app" '
    [inputs | fromjson? // empty
      | select(type == "object" and .loop == "feature" and .app == $app and ((.task // "") | test("^[A-Z][0-9]+$")))]
    | (last // null) as $l
    | if $l == null then empty else
        ([.[] | select(.task == $l.task and .event == "start")] | last | .detail // "") as $sd
        | "\($l.event // "")\t\($l.task)\t\((now - (($l.ts // "") | (fromdateiso8601? // 0))) | floor)\t\(if ($sd | tostring | startswith("build-next")) then "wf" else "session" end)"
      end' 2>/dev/null)
  if [ -n "$inflight" ]; then
    IFS=$'\t' read -r ev tk age who <<<"$inflight"
    case "$ev" in
      start|test_pass|test_fail|review_pass|review_fail|fixed)
        if [ "$who" = wf ] && [ "${age:-x}" -lt "$INFLIGHT_MAX_AGE" ] 2>/dev/null; then
          echo "stop gate: deferred, build-next is mid-task $tk (last ledger event '$ev' ${age}s ago); the workflow runs its own oracle" >&2
          exit 0
        fi ;;
    esac
  fi
fi

fingerprint() {
  {
    git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo no-head
    git -C "$ROOT" diff --cached -- "apps/$app" 2>/dev/null
    git -C "$ROOT" diff -- "apps/$app" 2>/dev/null
    (cd "$ROOT" && git ls-files -o --exclude-standard -z -- "apps/$app" 2>/dev/null | xargs -0 -r sha1sum 2>/dev/null)
  } | sha1sum | cut -d' ' -f1
}
fp=$(fingerprint)
if [ -f "$GREEN" ] && [ "$(cat "$GREEN" 2>/dev/null)" = "$fp" ]; then
  rm -f "$RETRIES"; exit 0            # nothing changed since the last green run
fi
if [ -f "$GAVEUP" ] && [ "$(cat "$GAVEUP" 2>/dev/null)" = "$fp" ]; then
  rm -f "$RETRIES"
  echo "stop gate: apps/$app is unchanged since the retry cap was hit on it (already logged blocked); not forcing again" >&2
  exit 0
fi

task=$("$ROOT/loop/observe.sh" next "$app" 2>/dev/null | cut -f1)
[ -n "$task" ] || task="-"

out=$(cd "$ROOT" && CI=1 npm --prefix "apps/$app" test --silent 2>&1)
rc=$?

if [ "$rc" -eq 0 ]; then
  rm -f "$RETRIES" "$GAVEUP"
  printf '%s\n' "$fp" >"$GREEN" 2>/dev/null
  "$LOG" inner "$app" "$task" test_pass "stop gate: npm test green" >/dev/null 2>&1 || true
  exit 0
fi

rm -f "$GREEN"
prev=$(tr -cd '0-9' 2>/dev/null <"$RETRIES" | cut -c1-3)
n=$(( ${prev:-0} + 1 ))
lastline=$(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -n 1 | cut -c1-160)

if [ "$n" -gt "$MAX_RETRIES" ]; then
  rm -f "$RETRIES"
  printf '%s\n' "$fp" >"$GAVEUP" 2>/dev/null
  "$LOG" inner "$app" "$task" blocked "stop gate: tests still red after $MAX_RETRIES retries; human look needed. $lastline" >/dev/null 2>&1 || true
  echo "STOP GATE: apps/$app tests are still red after $MAX_RETRIES forced retries. Letting the session stop; logged 'blocked'." >&2
  exit 0
fi

if ! printf '%s\n' "$n" >"$RETRIES" 2>/dev/null; then
  echo "stop gate: cannot write $RETRIES, so the retry cap cannot be enforced; letting the session stop" >&2
  exit 0
fi
"$LOG" inner "$app" "$task" test_fail "stop gate retry $n/$MAX_RETRIES: $lastline" >/dev/null 2>&1 || true
{
  echo "STOP GATE (inner loop): \`npm --prefix apps/$app test\` is RED (forced retry $n/$MAX_RETRIES). You may not stop yet."
  echo "Fix the code, not the tests: never skip, delete or weaken a test, never edit acceptance criteria (CLAUDE.md)."
  echo "If it truly needs a human: write a loop/decisions.md entry, log decision_needed, mark the task - [!],"
  echo "park the red attempt on branch loop/blocked-<id> so the main tree is green again (CLAUDE.md), then stop."
  echo "--- last 40 lines of npm test ---"
  printf '%s\n' "$out" | tail -n 40
} >&2
exit 2
