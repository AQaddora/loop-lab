#!/usr/bin/env bash
# Append one event to the loop ledger (loop/ledger.jsonl). Works from any cwd.
#
#   loop/log-event.sh <loop> <app> <task> <event> "<detail>" [commit-sha]
#
#   loop   inner | feature | venture | deploy   (session starts and the Stop gate log as inner)
#   app    attendance | meet | lab
#   task   T03 | M06 | D-004 | -
#   event  start test_pass test_fail review_pass review_fail fixed merged deployed
#          decision_needed decision_answered blocked done session_start
#
# commit: 6th arg if given; else HEAD short sha for merged|deployed; else "".
# Holder ping (optional, D-002): LOOP_NOTIFY_CMD (a host-local command that reads the text on stdin)
# and/or LOOP_TG_TOKEN + LOOP_TG_CHAT, from the env or ~/.config/loop-lab/loop.env. Events: LOOP_NOTIFY_EVENTS,
# default merged|blocked|decision_needed|deployed. A failed ping never fails the caller.
# Never put secrets in <detail>: the ledger is committed.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER="$ROOT/loop/ledger.jsonl"

usage() {
  sed -n '4,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 64
}
[ $# -ge 4 ] || usage

loop=$1 app=$2 task=$3 event=$4 detail=${5:-} commit=${6:-}

case "$loop" in inner|feature|venture|deploy) ;; *) echo "log-event: bad loop '$loop'" >&2; usage ;; esac
case "$app" in attendance|meet|lab) ;; *) echo "log-event: bad app '$app'" >&2; usage ;; esac
case "$event" in
  start|test_pass|test_fail|review_pass|review_fail|fixed|merged|deployed|decision_needed|decision_answered|blocked|done|session_start) ;;
  *) echo "log-event: bad event '$event'" >&2; usage ;;
esac
[ -n "$task" ] || task="-"

# one line, bounded size (keeps every append atomic and the live view readable); jq cuts at 500 characters, not bytes
detail=$(printf '%s' "$detail" | tr '\r\n\t' '   ')

if [ -z "$commit" ]; then
  case "$event" in
    merged|deployed) commit=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true) ;;
  esac
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
line=$(jq -nc \
  --arg ts "$ts" --arg loop "$loop" --arg app "$app" --arg task "$task" \
  --arg event "$event" --arg detail "$detail" --arg commit "$commit" \
  '{ts:$ts, loop:$loop, app:$app, task:$task, event:$event, detail:($detail | .[0:500]), commit:$commit}') || {
  echo "log-event: jq failed (is jq installed?)" >&2; exit 1; }

touch "$LEDGER"
if command -v flock >/dev/null 2>&1; then
  { flock -w 5 9 || true; printf '%s\n' "$line" >&9; } 9>>"$LEDGER"
else
  printf '%s\n' "$line" >>"$LEDGER"
fi

# ---- optional Telegram ping ------------------------------------------------
if [ -z "${LOOP_TG_TOKEN:-}" ] || [ -z "${LOOP_TG_CHAT:-}" ] || [ -z "${LOOP_NOTIFY_CMD:-}" ]; then
  # agents' shells may not inherit the holder's env: allow a private env file (mode 600)
  envf="${LOOP_ENV_FILE:-$HOME/.config/loop-lab/loop.env}"
  # shellcheck disable=SC1090
  [ -r "$envf" ] && . "$envf" 2>/dev/null
fi
# Which events ping the holder (D-002). Override with LOOP_NOTIFY_EVENTS="a|b|c" in loop.env.
case "|${LOOP_NOTIFY_EVENTS:-merged|blocked|decision_needed|deployed}|" in *"|${event}|"*) ;; *) exit 0 ;; esac
tag=$(printf '%s' "$event" | tr '[:lower:]_' '[:upper:] ')
text="[${tag}] loop-lab · ${app} ${task}"
[ -n "$detail" ] && text="${text}
$(printf '%s' "$line" | jq -r '.detail' 2>/dev/null)"
[ -n "$commit" ] && text="${text}
commit ${commit}"
# Host-local notifier (e.g. a fleet Telegram sender): LOOP_NOTIFY_CMD reads the text on stdin.
# Set it in loop.env, never in the repo. A failed ping never fails the caller.
if [ -n "${LOOP_NOTIFY_CMD:-}" ]; then
  printf '%s\n' "$text" | timeout 20 sh -c "$LOOP_NOTIFY_CMD" >/dev/null 2>&1 || true
fi
if [ -n "${LOOP_TG_TOKEN:-}" ] && [ -n "${LOOP_TG_CHAT:-}" ] && command -v curl >/dev/null 2>&1; then
  curl -fsS --max-time 8 -o /dev/null \
    "https://api.telegram.org/bot${LOOP_TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${LOOP_TG_CHAT}" \
    --data-urlencode "text=${text}" \
    --data-urlencode "disable_web_page_preview=true" >/dev/null 2>&1 || true
fi
exit 0
