#!/usr/bin/env bash
# Watch the loop. Works from any cwd and with an empty ledger.
#
#   loop/observe.sh              live colored event stream (tail -F loop/ledger.jsonl)
#   loop/observe.sh summary      backlog progress, ventures, ledger health, last 10 events, OPEN decisions, last commit
#   loop/observe.sh brief        plain-text context block (used by the SessionStart hook)
#   loop/observe.sh next <app>   next unblocked task: "<id><TAB><title>" (empty if none)
#
# Tip: watch -c -n 5 loop/observe.sh summary
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER="$ROOT/loop/ledger.jsonl"
DECISIONS="$ROOT/loop/decisions.md"
VENTURES="$ROOT/loop/ventures.md"
APPS="attendance meet"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then COLOR=true; else COLOR=false; fi
c() { if $COLOR; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }

# one ledger line -> one human line; malformed lines are skipped, never fatal
JQ_FMT='
def pad($n): tostring | if length < $n then . + (" " * ($n - length)) else . end;
def col($c): if $color then "\u001b[" + $c + "m" + . + "\u001b[0m" else . end;
fromjson? // empty
| ({"merged":"1;32","deployed":"1;32","done":"1;32","test_pass":"32","review_pass":"32",
    "fixed":"36","start":"34","test_fail":"31","review_fail":"31","blocked":"1;31",
    "decision_needed":"1;33","decision_answered":"33","session_start":"90"}[.event // ""] // "0") as $ec
| (.ts // "") as $ts
| "\(($ts[5:10] + " " + $ts[11:19]) | col("90")) \((.loop // "-") | pad(8) | col("35"))\((.app // "-") | pad(11))\((.task // "-") | pad(6) | col("1"))\((.event // "?") | pad(18) | col($ec))\(.detail // "")\(if (.commit // "") != "" then "  " + (.commit | col("90")) else "" end)"
'

# backlog task lines -> "status<TAB>id<TAB>title<TAB>deps"
parse_backlog() {
  [ -f "$1" ] || return 0
  awk '
    /^- \[[ x!]\] [A-Z][0-9]+ / {
      st = substr($0, 4, 1); rest = substr($0, 7)
      sp = index(rest, " "); id = substr(rest, 1, sp - 1); rest = substr(rest, sp + 1)
      if (index(rest, "· ") == 1) rest = substr(rest, length("· ") + 1)
      di = index(rest, " — deps:"); title = rest; deps = "none"
      if (di > 0) {
        title = substr(rest, 1, di - 1)
        d = substr(rest, di + length(" — deps:")); wi = index(d, " — done when")
        if (wi > 0) d = substr(d, 1, wi - 1)
        gsub(/^ +| +$/, "", d); deps = d
      }
      printf "%s\t%s\t%s\t%s\n", (st == " " ? "open" : (st == "x" ? "done" : "blocked")), id, title, deps
    }' "$1"
}

# first open task whose deps are all [x]
next_task() {
  parse_backlog "$ROOT/loop/backlog-$1.md" | awk -F'\t' '
    { st[$2] = $1; ord[++n] = $2; ti[$2] = $3; dp[$2] = $4 }
    END {
      for (i = 1; i <= n; i++) {
        id = ord[i]; if (st[id] != "open") continue
        ok = 1; m = split(dp[id], a, /[^A-Za-z0-9]+/)
        for (j = 1; j <= m; j++) if (a[j] ~ /^[A-Z][0-9]+$/ && st[a[j]] != "done") { ok = 0; break }
        if (ok) { printf "%s\t%s\n", id, ti[id]; exit }
      }
    }'
}

# counts "done open blocked total"
backlog_counts() {
  parse_backlog "$ROOT/loop/backlog-$1.md" | awk -F'\t' '
    { n[$1]++; t++ } END { printf "%d %d %d %d\n", n["done"], n["open"], n["blocked"], t }'
}

# OPEN decision entries -> "app<TAB>D-001 · question" (fenced examples are ignored)
open_decisions() {
  [ -f "$DECISIONS" ] || return 0
  awk '
    /^```/ { fence = !fence; next }
    fence { next }
    /^## D-[0-9]+/ { hdr = $0; sub(/^## /, "", hdr); next }
    hdr != "" && /status:/ {
      if ($0 ~ /status:[ *]*OPEN/) {
        app = "?"; if (match($0, /app:[ ]*[a-z]+/)) { app = substr($0, RSTART + 4, RLENGTH - 4); gsub(/ /, "", app) }
        printf "%s\t%s\n", app, hdr
      }
      hdr = ""
    }' "$DECISIONS"
}

# ventures.md pool rows -> "pool 16 · queued 0 · ..."
venture_counts() {
  [ -f "$VENTURES" ] || return 0
  awk -F'|' '
    /^\| *V-[0-9]+ *\|/ { s = $(NF - 1); gsub(/^ +| +$/, "", s); split(s, w, /[ (]/); n[tolower(w[1])]++; t++ }
    END { if (t) printf "pool %d · queued %d · approved %d · built %d · rejected %d (of %d)\n", n["pool"], n["queued"], n["approved"], n["built"], n["rejected"], t }
  ' "$VENTURES"
}

bar() { # done total
  local d=$1 t=$2 w=20 f=0
  [ "$t" -gt 0 ] && f=$(( d * w / t ))
  printf '['; printf '%*s' "$f" '' | tr ' ' '#'; printf '%*s' $(( w - f )) '' | tr ' ' '.'; printf ']'
}

last_commit() { git -C "$ROOT" log -1 --format='%h %s (%cr)' 2>/dev/null || echo "(no commits yet)"; }

events() { # n
  [ -s "$LEDGER" ] || { echo "  (ledger empty: no events yet)"; return; }
  tail -n "$1" "$LEDGER" | jq -R -r --argjson color "$COLOR" "$JQ_FMT" | sed 's/^/  /'
}

cmd_summary() {
  echo "$(c '1;36' 'loop-lab') · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "$(c 1 'Backlogs')"
  for app in $APPS; do
    if [ ! -f "$ROOT/loop/backlog-$app.md" ]; then printf '  %-11s (no backlog yet)\n' "$app"; continue; fi
    read -r d o b t < <(backlog_counts "$app")
    nx=$(next_task "$app"); nx=${nx/$'\t'/ · }
    printf '  %-11s %s %2d/%-2d done · %d open · %s\n' "$app" "$(bar "$d" "$t")" "$d" "$t" "$o" \
      "$( [ "$b" -gt 0 ] && c '1;31' "$b blocked" || echo '0 blocked')"
    printf '  %-11s next: %s\n' "" "${nx:-$( [ "$o" -eq 0 ] && [ "$b" -eq 0 ] && [ "$t" -gt 0 ] && echo 'backlog complete' || echo 'nothing unblocked (see decisions)')}"
  done
  vc=$(venture_counts); [ -n "$vc" ] && printf '  %-11s ventures: %s\n' "meet" "$vc"
  if [ -f "$ROOT/loop/.gate" ]; then echo "  gate: ON for $(head -n1 "$ROOT/loop/.gate") (Stop hook runs npm test)"; else echo "  gate: off (echo <app> > loop/.gate)"; fi
  echo
  echo "$(c 1 'Ledger health')"
  if [ -s "$LEDGER" ]; then
    jq -R 'fromjson? // empty' "$LEDGER" | jq -s -r '
      group_by(.event) | map("\(.[0].event)=\(length)") | join("  ")' | sed 's/^/  /'
  else
    echo "  (ledger empty)"
  fi
  echo
  echo "$(c 1 'Last 10 events')"
  events 10
  echo
  od=$(open_decisions)
  n=0; [ -n "$od" ] && n=$(printf '%s\n' "$od" | wc -l)
  echo "$(c 1 'OPEN decisions'): $( [ "$n" -gt 0 ] && c '1;33' "$n" || echo 0) (loop/decisions.md is the holder's inbox)"
  [ -n "$od" ] && printf '%s\n' "$od" | awk -F'\t' '{ printf "  [%s] %s\n", $1, $2 }'
  echo
  echo "$(c 1 'Last commit'): $(last_commit)"
}

cmd_brief() {
  COLOR=false
  echo "## loop-lab state (SessionStart hook, $(date -u +%Y-%m-%dT%H:%M:%SZ))"
  for app in $APPS; do
    [ -f "$ROOT/loop/backlog-$app.md" ] || { echo "- $app: no backlog yet"; continue; }
    read -r d o b t < <(backlog_counts "$app")
    nx=$(next_task "$app"); nx=${nx/$'\t'/ · }
    echo "- $app: $d/$t done, $o open, $b blocked; next: ${nx:-none unblocked}"
  done
  od=$(open_decisions)
  if [ -n "$od" ]; then
    echo "- OPEN decisions ($(printf '%s\n' "$od" | wc -l)), the loop holder answers in loop/decisions.md:"
    printf '%s\n' "$od" | awk -F'\t' '{ printf "  - [%s] %s\n", $1, $2 }'
  else
    echo "- OPEN decisions: none"
  fi
  if [ -f "$ROOT/loop/.gate" ]; then
    echo "- Stop gate ON for $(head -n1 "$ROOT/loop/.gate"): you cannot end a turn while its tests are red (max 3 retries; it stands aside while build-next is mid-task)."
  fi
  echo "- last commit: $(last_commit)"
  if [ -s "$LEDGER" ]; then echo "- last events:"; events 5 | sed 's/^  /  - /'; fi
  echo "Rules: CLAUDE.md. One backlog task per iteration; never ask the holder in chat (write loop/decisions.md); never weaken tests."
}

case "${1:-live}" in
  live)
    touch "$LEDGER"
    echo "$(c '1;36' 'loop-lab live') · tail -F loop/ledger.jsonl · Ctrl-C to quit · 'loop/observe.sh summary' for the snapshot"
    tail -n 30 -F "$LEDGER" 2>/dev/null | jq -R -r --unbuffered --argjson color "$COLOR" "$JQ_FMT"
    ;;
  summary) cmd_summary ;;
  brief) cmd_brief ;;
  next)
    case "${2:-}" in attendance|meet) next_task "$2" ;; *) echo "usage: loop/observe.sh next attendance|meet" >&2; exit 64 ;; esac
    ;;
  -h|--help|help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) echo "unknown subcommand '$1' (live | summary | brief | next <app>)" >&2; exit 64 ;;
esac
