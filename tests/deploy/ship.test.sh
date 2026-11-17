#!/usr/bin/env bash
# Tests for loop/deploy/ship.sh. Run from anywhere: bash tests/deploy/ship.test.sh
#
# Nothing real is touched: no docker, no ssh, no network, not this repo's ledger, decisions, state or tags.
# The test copies ship.sh into a throwaway git repo (with a bare "origin" next to it) in a temp dir, puts stubs for
# docker, the DEPLOY_SSH command (fake-ssh), curl and the smoke script first on PATH, points LOOP_LOG_EVENT at a stub
# ledger (loop/log-event.sh has no ledger-path override, and the real one may ping Telegram) and LOOP_DECISIONS at a
# temp copy. SHIP_HEALTH_TIMEOUT=1 keeps the red health cases short.
# Stub controls, as files in $STUB: build-exit, smoke-exit, smoke-hang (the smoke blocks until it is killed),
# from-image-exit-<sha12> (git:from-image of that image fails), from-image-hang-<sha12> (it blocks until killed),
# health-mode-<sha12> (what /api/health answers while that image is live: ok | 500 | wrong | noversion | notok).
# Each check prints PASS or FAIL; the script exits 1 if any check fails.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SHIP_SRC="$HERE/../../loop/deploy/ship.sh"
[ -f "$SHIP_SRC" ] || { echo "ERROR: $SHIP_SRC not found"; exit 2; }
for c in git jq flock sha256sum timeout; do command -v "$c" >/dev/null 2>&1 || { echo "ERROR: $c is missing"; exit 2; }; done

T=$(mktemp -d "${TMPDIR:-/tmp}/ship-test.XXXXXX") || exit 2
trap 'rm -rf "$T"' EXIT
BIN="$T/bin" STUB="$T/stub" REPO="$T/repo" URL="https://attendance.example.invalid"
mkdir -p "$BIN" "$STUB" "$REPO" "$T/home" "$T/tmp"

npass=0 nfail=0
check() { # <name> <command...>
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $name"; npass=$((npass + 1))
  else echo "FAIL $name"; nfail=$((nfail + 1)); fi
}
lines() { if [ -f "$1" ]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }
contains() { grep -qF -- "$2" "$1"; }
lacks() { ! grep -qF -- "$2" "$1"; }
is() { [ "$1" = "$2" ]; }
dead() { ! kill -0 "$1" 2>/dev/null; }

# ---- stubs -------------------------------------------------------------------
cat >"$BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB/docker.log"
case "$1" in
  build)
    ctx=${!#} f="" prev=""
    for a in "$@"; do [ "$prev" = "-f" ] && f=$a; prev=$a; done
    [ -f "$f" ] || { echo "stub docker: no Dockerfile at $f" >&2; exit 1; }
    printf '%s\n' "$ctx" >"$STUB/build-context"
    cat "$ctx/marker.txt" >"$STUB/build-marker" 2>/dev/null
    exit "$(cat "$STUB/build-exit" 2>/dev/null || echo 0)" ;;
  save) printf 'stub-image-tar %s\n' "$2" ;;
  *) echo "stub docker: unexpected: $*" >&2; exit 1 ;;
esac
EOF
# git:from-image records whether the pause file existed when it ran, and only a successful one changes what is live.
cat >"$BIN/fake-ssh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$1" >>"$STUB/ssh-hosts.log"; shift
printf '%s\n' "$*" >>"$STUB/ssh.log"
case "$1 $2" in
  "docker load") cat >"$STUB/loaded"; echo "Loaded image" ;;
  "dokku git:from-image")
    if [ -e "$SHIP_TEST_PAUSE" ]; then p=paused; else p=not-paused; fi
    printf '%s %s\n' "$4" "$p" >>"$STUB/from-image.log"
    if [ -e "$STUB/from-image-hang-${4##*:}" ]; then
      printf '%s\n' "$$" >"$STUB/from-image-pid"; : >"$STUB/from-image-started"; exec sleep 60
    fi
    rc=$(cat "$STUB/from-image-exit-${4##*:}" 2>/dev/null || echo 0)
    [ "$rc" -ne 0 ] || printf '%s\n' "$4" >"$STUB/live"
    exit "$rc" ;;
  *) echo "stub ssh: unexpected: $*" >&2; exit 1 ;;
esac
EOF
cat >"$BIN/curl" <<'EOF'
#!/usr/bin/env bash
out="" fmt="" url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift 2 ;; -w) fmt=$2; shift 2 ;; --max-time) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac
done
printf '%s\n' "$url" >>"$STUB/curl.log"
live=$(cat "$STUB/live" 2>/dev/null); tag=${live##*:}
code=200
case "$(cat "$STUB/health-mode-$tag" 2>/dev/null || echo ok)" in
  500) code=500 body='{"error":"stub"}' ;;
  wrong) body='{"ok":true,"version":"0123456789ab"}' ;;
  noversion) body='{"ok":true}' ;;
  notok) body=$(printf '{"ok":false,"version":"%s"}' "$tag") ;;
  *) body=$(printf '{"ok":true,"version":"%s"}' "$tag") ;;
esac
if [ -n "$out" ]; then printf '%s' "$body" >"$out"; else printf '%s' "$body"; fi
[ -z "$fmt" ] || printf '%s' "$code"
EOF
cat >"$BIN/fake-smoke" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s\n' "$PWD" "$*" >>"$STUB/smoke.log"
if [ -e "$STUB/smoke-hang" ]; then
  printf '%s\n' "$$" >"$STUB/smoke-pid"
  : >"$STUB/smoke-started"
  exec sleep 60
fi
exit "$(cat "$STUB/smoke-exit" 2>/dev/null || echo 0)"
EOF
cat >"$BIN/log-event" <<'EOF'
#!/usr/bin/env bash
jq -nc --arg loop "$1" --arg app "$2" --arg task "$3" --arg event "$4" --arg detail "${5:-}" --arg commit "${6:-}" \
  '{loop: $loop, app: $app, task: $task, event: $event, detail: $detail, commit: $commit}' >>"$STUB/ledger.jsonl"
EOF
chmod +x "$BIN"/*

# ---- a throwaway repo with the app's shape, and a bare origin ------------------
export GIT_CONFIG_NOSYSTEM=1 HOME="$T/home"
g() { git -C "$REPO" -c user.name=ship-test -c user.email=ship-test@example.invalid -c commit.gpgsign=false -c tag.gpgsign=false "$@"; }
git init -q --bare "$T/origin.git"
g init -q -b main
mkdir -p "$REPO/apps/attendance/scripts" "$REPO/loop/deploy"
printf 'FROM scratch\n' >"$REPO/apps/attendance/Dockerfile"
printf 'committed A\n' >"$REPO/apps/attendance/marker.txt"
printf '#!/usr/bin/env bash\n# AC-39 (stub)\nexec fake-smoke "$@"\n' >"$REPO/apps/attendance/scripts/smoke-remote.sh"
cp "$SHIP_SRC" "$REPO/loop/deploy/ship.sh"
g add -A && g commit -qm "commit A"
g remote add origin "$T/origin.git"
g push -q origin main
A=$(g rev-parse HEAD) A12=${A:0:12}

cat >"$T/deploy.env" <<EOF
# test config
DEPLOY_SSH="fake-ssh apps-host"
DOKKU_APP=attendance
PUBLIC_URL=$URL
IMAGE_REPO=loop-lab-attendance
FLEET_DEPLOYMENTS_LOG=$T/fleet.jsonl
EOF
cat >"$T/decisions.md" <<'EOF'
# Decisions (test copy)

## Queue

## D-023 · STEER · test entry
- app: attendance | status: ANSWERED

## D-024 · PROD-1 · test entry
- app: attendance | status: ANSWERED
EOF

STATE="$REPO/loop/deploy/state.json" PAUSE="$REPO/loop/.deploy-paused" INFLIGHT="$REPO/loop/deploy/inflight.json"
ship_env() { # fills ENVV for one run
  ENVV=(PATH="$BIN:$PATH" TMPDIR="$T/tmp" STUB="$STUB" SHIP_TEST_PAUSE="$PAUSE"
    LOOP_DEPLOY_ENV="${CFG_OVERRIDE:-$T/deploy.env}" LOOP_LOG_EVENT="$BIN/log-event" LOOP_DECISIONS="$T/decisions.md"
    SHIP_HEALTH_TIMEOUT=1 SHIP_HEALTH_INTERVAL=0.2)
}
ship() { # <args...>; sets RC, output in $T/out
  ship_env
  (cd "$REPO" && env -u LOOP_TG_TOKEN -u LOOP_TG_CHAT -u LOOP_NOTIFY_CMD "${ENVV[@]}" \
    bash "${SHIP_SCRIPT:-$REPO/loop/deploy/ship.sh}" "$@") >"$T/out" 2>&1
  RC=$?
}
ship_bg() { # <args...>; runs ship.sh in the background, sets PID (the pid of ship.sh's own bash)
  ship_env
  (cd "$REPO" && exec env -u LOOP_TG_TOKEN -u LOOP_TG_CHAT -u LOOP_NOTIFY_CMD "${ENVV[@]}" \
    bash "$REPO/loop/deploy/ship.sh" "$@") >"$T/out" 2>&1 &
  PID=$!
}
wait_for() { local _i; for _i in $(seq 1 100); do [ -e "$1" ] && return 0; sleep 0.1; done; return 1; }
snap() {
  (cd "$REPO" && find . -path ./.git -prune -o -print | LC_ALL=C sort &&
    find . -path ./.git -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum && git for-each-ref)
  ls -A "$T/tmp" "$STUB"
  sha256sum "$T/decisions.md"
}
ledger_event() { jq -r '.event' "$STUB/ledger.jsonl" | sed -n "${1}p"; }
events_since() { tail -n +"$(($1 + 1))" "$STUB/ledger.jsonl" | jq -r .event | tr '\n' ' '; }
last_detail() { jq -r --arg e "$1" 'select(.event == $e) | .detail' "$STUB/ledger.jsonl" | tail -n 1; }
from_image_since() { tail -n +"$(($1 + 1))" "$STUB/from-image.log" | tr '\n' ';'; }
last_did() { grep -oE '^## D-[0-9]+' "$T/decisions.md" | tail -n 1 | cut -c 4-; }
live() { cat "$STUB/live" 2>/dev/null; }

# ---- 1. dry run touches nothing ----------------------------------------------
echo "== dry run"
snap >"$T/before"
ship main --dry-run
snap >"$T/after"
check "dry run exits 0" is "$RC" 0
check "dry run prints the plan with the image tag" contains "$T/out" "loop-lab-attendance:$A12"
check "dry run says it is a dry run" contains "$T/out" "dry run"
check "dry run checks that origin/main contains the commit" contains "$T/out" "origin/main contains $A12"
check "dry run leaves the repo, tags, temp dir, decisions and stubs unchanged" cmp -s "$T/before" "$T/after"
check "dry run calls no docker, ssh, curl, smoke or ledger" is "$(ls -A "$STUB")" ""
check "dry run takes no lock file" test ! -e "$REPO/loop/deploy/.lock"
check "dry run never prints the DEPLOY_SSH value" lacks "$T/out" "fake-ssh"

# ---- 2. green path -----------------------------------------------------------
echo "== green deploy of A (working tree has an uncommitted change)"
printf 'UNCOMMITTED\n' >"$REPO/apps/attendance/marker.txt"
ship main
cat "$T/out" >"$T/out.green"
check "green exits 0" is "$RC" 0
check "state.json sha is A" is "$(jq -r .sha "$STATE" 2>/dev/null)" "$A"
check "state.json image is loop-lab-attendance:<sha12>" is "$(jq -r .image "$STATE" 2>/dev/null)" "loop-lab-attendance:$A12"
check "state.json url is PUBLIC_URL" is "$(jq -r .url "$STATE" 2>/dev/null)" "$URL"
check "state.json has a UTC deployed_at" grep -Eq '"deployed_at": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"' "$STATE"
check "state.json has exactly sha, image, url, deployed_at" is "$(jq -c 'keys' "$STATE" 2>/dev/null)" '["deployed_at","image","sha","url"]'
check "no in-flight marker after green" test ! -e "$INFLIGHT"
check "built only from the commit, not the working tree" is "$(cat "$STUB/build-marker" 2>/dev/null)" "committed A"
check "build context was a temp export, not the repo" grep -q "^$T/tmp/" "$STUB/build-context"
check "the export was removed afterwards" is "$(ls -A "$T/tmp")" ""
check "docker build got --build-arg GIT_SHA=<full sha>" contains "$STUB/docker.log" "build --build-arg GIT_SHA=$A -t loop-lab-attendance:$A12 -f "
check "docker save | DEPLOY_SSH docker load shipped the image" contains "$STUB/loaded" "loop-lab-attendance:$A12"
check "DEPLOY_SSH was used as given (host apps-host)" is "$(sort -u "$STUB/ssh-hosts.log")" "apps-host"
check "dokku git:from-image ran with the new image" contains "$STUB/ssh.log" "dokku git:from-image attendance loop-lab-attendance:$A12"
check "health was checked at PUBLIC_URL/api/health" contains "$STUB/curl.log" "$URL/api/health"
check "health saw version == sha12" contains "$T/out" "health: 200, ok, version $A12"
check "smoke ran against PUBLIC_URL from the export" grep -q "^$T/tmp/.*|$URL\$" "$STUB/smoke.log"
check "ledger has one event: deployed" is "$(lines "$STUB/ledger.jsonl")/$(ledger_event 1)" "1/deployed"
check "deployed detail is '<url> <sha12>'" is "$(last_detail deployed)" "$URL $A12"
check "deployed is logged as deploy/attendance/<sha12> with commit <sha12>" \
  is "$(jq -r 'select(.event=="deployed") | "\(.loop) \(.app) \(.task) \(.commit)"' "$STUB/ledger.jsonl")" "deploy attendance $A12 $A12"
TAG=$(g tag -l 'deploy/*')
check "one tag deploy/<UTC yyyymmddThhmmssZ>" grep -Eqx 'deploy/[0-9]{8}T[0-9]{6}Z' <<<"$TAG"
check "the tag points at A" is "$(g rev-list -n1 "$TAG" 2>/dev/null)" "$A"
check "one fleet deployments line, status live, with the url and sha12" \
  is "$(lines "$T/fleet.jsonl")|$(jq -r '"\(.status)|\(.url)|\(.id | contains("'"$A12"'"))"' "$T/fleet.jsonl" 2>/dev/null)" "1|live|$URL|true"
check "no pause file after green" test ! -e "$PAUSE"
check "no decision opened after green" is "$(last_did)" "D-024"
g checkout -q -- apps/attendance/marker.txt

# ---- 3. red smoke rolls back and pauses ---------------------------------------
echo "== red smoke on B"
printf 'committed B\n' >"$REPO/apps/attendance/marker.txt"
g commit -qam "commit B"
g push -q origin main
B=$(g rev-parse HEAD) B12=${B:0:12}
ssh_before=$(lines "$STUB/ssh.log") fi_before=$(lines "$STUB/from-image.log")
echo 1 >"$STUB/smoke-exit"
ship main
rm -f "$STUB/smoke-exit"
check "red smoke exits 1" is "$RC" 1
check "B was deployed, then A was redeployed (rollback)" \
  is "$(tail -n +"$((ssh_before + 1))" "$STUB/ssh.log" | grep 'git:from-image' | tr '\n' ';')" \
  "dokku git:from-image attendance loop-lab-attendance:$B12;dokku git:from-image attendance loop-lab-attendance:$A12;"
check "the pause file existed before the rollback ran (pause first)" \
  is "$(from_image_since "$fi_before")" "loop-lab-attendance:$B12 not-paused;loop-lab-attendance:$A12 paused;"
check "A is live again" is "$(live)" "loop-lab-attendance:$A12"
check "pause file written" test -f "$PAUSE"
check "pause file gives the reason" contains "$PAUSE" "reason: smoke red on $B12: smoke-remote.sh exit 1"
check "pause file records the rollback" contains "$PAUSE" "rollback: rolled back to loop-lab-attendance:$A12 (health: 200, ok, version $A12)"
check "ledger: test_fail, blocked, decision_needed after deployed" \
  is "$(jq -r .event "$STUB/ledger.jsonl" | tr '\n' ' ')" "deployed test_fail blocked decision_needed "
check "blocked detail says paused and names the rollback" \
  grep -q '"event":"blocked","detail":"deploy paused: smoke red on '"$B12"'.*rolled back to loop-lab-attendance:'"$A12" "$STUB/ledger.jsonl"
check "a decision D-025 was opened, status OPEN" \
  grep -qx "## D-025 · DEPLOY · Deploy of $B12 failed its smoke check, and deploys are paused. How does the loop resume?" "$T/decisions.md"
check "the decision has the decisions.md fields" \
  is "$(sed -n '/^## D-025 /,$p' "$T/decisions.md" | cut -d: -f1 | tr '\n' '|')" \
  "## D-025 · DEPLOY · Deploy of $B12 failed its smoke check, and deploys are paused. How does the loop resume?|- app|- context|- options|- recommendation|- answer|"
check "the decision is OPEN for attendance" contains "$T/decisions.md" "- app: attendance | status: OPEN"
check "the pause file names the decision" contains "$PAUSE" "decision: D-025"
check "the blocked detail names the decision" contains "$STUB/ledger.jsonl" "D-025; the holder deletes loop/.deploy-paused"
check "decision_needed is logged with task D-025 and the D-id first in the detail" \
  is "$(tail -n 1 "$STUB/ledger.jsonl" | jq -r '"\(.event)|\(.task)|\(.detail | startswith("D-025: "))"')" "decision_needed|D-025|true"
check "no in-flight marker after red" test ! -e "$INFLIGHT"
check "state.json still names A" is "$(jq -r .sha "$STATE")" "$A"
check "no tag for the red deploy" is "$(g tag -l 'deploy/*' | wc -l | tr -d ' ')" 1
check "no fleet line for the red deploy" is "$(lines "$T/fleet.jsonl")" 1

# ---- 4. paused refuses ---------------------------------------------------------
echo "== paused"
before="$(lines "$STUB/docker.log") $(lines "$STUB/ssh.log") $(lines "$STUB/curl.log") $(lines "$STUB/ledger.jsonl")"
ship main
check "a real run refuses while paused (exit 3)" is "$RC" 3
check "the refusal says PAUSED" contains "$T/out" "PAUSED"
ship main --dry-run
check "a dry run also refuses while paused (exit 3)" is "$RC" 3
check "paused runs call no docker, ssh, curl or ledger" \
  is "$(lines "$STUB/docker.log") $(lines "$STUB/ssh.log") $(lines "$STUB/curl.log") $(lines "$STUB/ledger.jsonl")" "$before"
check "the pause file stays (only the holder deletes it)" test -f "$PAUSE"
rm -f "$PAUSE"   # the holder clears it
ship main --dry-run
check "after the holder clears it, the dry run plans a rollback to A" contains "$T/out" "redeploy loop-lab-attendance:$A12"
check "the dry run names the next decision id" contains "$T/out" "open D-026"

# ---- 5. build failure: production untouched, no pause --------------------------
echo "== build failure"
ssh_before=$(lines "$STUB/ssh.log")
echo 1 >"$STUB/build-exit"
ship main
rm -f "$STUB/build-exit"
check "a failed build exits 1" is "$RC" 1
check "a failed build never reaches the Dokku host" is "$(lines "$STUB/ssh.log")" "$ssh_before"
check "a failed build logs test_fail, production untouched" \
  is "$(tail -n 1 "$STUB/ledger.jsonl" | jq -r '"\(.event)|\(.detail | contains("production untouched"))"')" "test_fail|true"
check "a failed build does not pause" test ! -e "$PAUSE"
check "a failed build leaves no in-flight marker" test ! -e "$INFLIGHT"

# ---- 6. one deploy at a time ---------------------------------------------------
echo "== lock"
before="$(lines "$STUB/docker.log")"
exec 8>"$REPO/loop/deploy/.lock"; flock 8
ship main
exec 8>&-
check "a second deploy refuses while the lock is held (exit 4)" is "$RC" 4
check "the locked-out run builds nothing" is "$(lines "$STUB/docker.log")" "$before"

# ---- 7. config never from the repo ---------------------------------------------
echo "== config location"
cp "$T/deploy.env" "$REPO/deploy.env"
CFG_OVERRIDE="$REPO/deploy.env" ship main --dry-run
check "a config inside the repo is refused (exit 2)" is "$RC" 2
rm -f "$REPO/deploy.env"

# ---- 8. deploy red: git:from-image of the new image fails -----------------------
echo "== deploy red on B"
echo 1 >"$STUB/from-image-exit-$B12"
n=$(lines "$STUB/ledger.jsonl") fi_before=$(lines "$STUB/from-image.log")
ship "$B"
rm -f "$STUB/from-image-exit-$B12"
check "a failed git:from-image exits 1" is "$RC" 1
check "the pause file says deploy red" contains "$PAUSE" "reason: deploy red on $B12: dokku git:from-image exit 1"
check "it rolled back to A after writing the pause" \
  is "$(from_image_since "$fi_before")" "loop-lab-attendance:$B12 not-paused;loop-lab-attendance:$A12 paused;"
check "A is live" is "$(live)" "loop-lab-attendance:$A12"
check "no health wait for B and no smoke" lacks "$T/out" "waiting up to"
check "ledger: test_fail, blocked, decision_needed" is "$(events_since "$n")" "test_fail blocked decision_needed "
check "the pause file names the new decision" contains "$PAUSE" "decision: $(last_did)"
check "state.json still names A" is "$(jq -r .sha "$STATE")" "$A"
rm -f "$PAUSE"

# ---- 9. health red: wrong version, non-200, ok not true ------------------------
for mode in wrong 500 notok; do
  echo "== health red on B ($mode)"
  case "$mode" in
    wrong) want="health red on $B12: 200 but version 0123456789ab, not $B12 after 1 s" ;;
    500) want="health red on $B12: HTTP 500 after 1 s" ;;
    notok) want="health red on $B12: 200 but the body has no \"ok\": true after 1 s" ;;
  esac
  echo "$mode" >"$STUB/health-mode-$B12"
  n=$(lines "$STUB/ledger.jsonl") smoke_before=$(lines "$STUB/smoke.log")
  ship "$B"
  rm -f "$STUB/health-mode-$B12"
  check "health $mode: exits 1" is "$RC" 1
  check "health $mode: the pause file gives the reason" contains "$PAUSE" "reason: $want"
  check "health $mode: rolled back to A" is "$(live)" "loop-lab-attendance:$A12"
  check "health $mode: no smoke ran" is "$(lines "$STUB/smoke.log")" "$smoke_before"
  check "health $mode: ledger test_fail, blocked, decision_needed" is "$(events_since "$n")" "test_fail blocked decision_needed "
  rm -f "$PAUSE"
done

echo "== a wrong version is red even with --allow-no-version"
echo wrong >"$STUB/health-mode-$B12"
ship "$B" --allow-no-version
rm -f "$STUB/health-mode-$B12"
check "wrong version + --allow-no-version: exits 1" is "$RC" 1
check "wrong version + --allow-no-version: health red" contains "$PAUSE" "reason: health red on $B12: 200 but version 0123456789ab"
rm -f "$PAUSE"

# ---- 10. the rollback itself fails ---------------------------------------------
echo "== red smoke on B, and the rollback to A fails"
echo 1 >"$STUB/smoke-exit"; echo 1 >"$STUB/from-image-exit-$A12"
n=$(lines "$STUB/ledger.jsonl")
ship "$B"
rm -f "$STUB/smoke-exit" "$STUB/from-image-exit-$A12"
check "a failed rollback exits 1" is "$RC" 1
check "the pause file says the rollback FAILED" contains "$PAUSE" "rollback: rollback to loop-lab-attendance:$A12 FAILED (dokku git:from-image exit 1)"
check "the blocked detail says the rollback FAILED" contains "$STUB/ledger.jsonl" "rollback to loop-lab-attendance:$A12 FAILED"
check "the decision says to check what is live first" contains "$T/decisions.md" "First check by hand what is live: the rollback did not end green."
check "ledger: test_fail, blocked, decision_needed" is "$(events_since "$n")" "test_fail blocked decision_needed "
echo "loop-lab-attendance:$A12" >"$STUB/live"   # the holder repairs production by hand
rm -f "$PAUSE"

# ---- 11. health without a version field ----------------------------------------
echo "== health without a version, strict (the default)"
echo noversion >"$STUB/health-mode-$B12"
ship "$B"
rm -f "$STUB/health-mode-$B12"
check "no version field: exits 1 without --allow-no-version" is "$RC" 1
check "no version field: health red" contains "$PAUSE" "reason: health red on $B12: 200 and ok, but no version field"
check "no version field: rolled back to A" is "$(live)" "loop-lab-attendance:$A12"
rm -f "$PAUSE"

# ---- 12. SIGTERM during the smoke rolls back and pauses ---------------------------
echo "== SIGTERM during the smoke of B"
: >"$STUB/smoke-hang"; rm -f "$STUB/smoke-started" "$STUB/smoke-pid"
n=$(lines "$STUB/ledger.jsonl") fi_before=$(lines "$STUB/from-image.log")
ship_bg "$B"
if wait_for "$STUB/smoke-started"; then kill -TERM "$PID"; fi
wait "$PID"; RC=$?
rm -f "$STUB/smoke-hang"
check "SIGTERM during the smoke: exits 1" is "$RC" 1
check "SIGTERM during the smoke: the pause file gives the reason" contains "$PAUSE" "reason: smoke red on $B12: interrupted by SIGTERM"
check "SIGTERM during the smoke: rolled back to A after writing the pause" \
  is "$(from_image_since "$fi_before")" "loop-lab-attendance:$B12 not-paused;loop-lab-attendance:$A12 paused;"
check "SIGTERM during the smoke: A is live" is "$(live)" "loop-lab-attendance:$A12"
check "SIGTERM during the smoke: ledger test_fail, blocked, decision_needed" is "$(events_since "$n")" "test_fail blocked decision_needed "
check "SIGTERM during the smoke: the smoke process was stopped" dead "$(cat "$STUB/smoke-pid" 2>/dev/null || echo 999999)"
check "SIGTERM during the smoke: no in-flight marker is left" test ! -e "$INFLIGHT"
check "SIGTERM during the smoke: the decision says it was interrupted" \
  contains "$T/decisions.md" "Deploy of $B12 was interrupted during its smoke step"
check "SIGTERM during the smoke: state.json still names A" is "$(jq -r .sha "$STATE")" "$A"
ship "$B"
check "after SIGTERM, the next run refuses (exit 3)" is "$RC" 3
rm -f "$PAUSE"

# ---- 13. SIGKILL during the smoke: the next start finds the marker ---------------
echo "== SIGKILL during the smoke of B"
: >"$STUB/smoke-hang"; rm -f "$STUB/smoke-started" "$STUB/smoke-pid"
n=$(lines "$STUB/ledger.jsonl")
ship_bg "$B"
if wait_for "$STUB/smoke-started"; then kill -KILL "$PID"; fi
wait "$PID" 2>/dev/null
kill "$(cat "$STUB/smoke-pid" 2>/dev/null || echo 999999)" 2>/dev/null   # the orphaned smoke
rm -f "$STUB/smoke-hang"
for _ in $(seq 1 100); do flock -n "$REPO/loop/deploy/.lock" true && break; sleep 0.1; done   # orphans hold the lock
rm -rf "$T"/tmp/loop-ship.*   # SIGKILL skips ship.sh's EXIT trap
check "after SIGKILL: the in-flight marker is left" test -f "$INFLIGHT"
check "after SIGKILL: the marker names B and the smoke step" is "$(jq -r '"\(.sha) \(.stage) \(.prev_image)"' "$INFLIGHT" 2>/dev/null)" "$B smoke loop-lab-attendance:$A12"
check "after SIGKILL: no pause (no trap could run)" test ! -e "$PAUSE"
check "after SIGKILL: B is still live" is "$(live)" "loop-lab-attendance:$B12"
check "after SIGKILL: nothing was logged" is "$(lines "$STUB/ledger.jsonl")" "$n"
snap >"$T/before"
ship "$B" --dry-run
snap >"$T/after"
check "after SIGKILL: a dry run reports the interrupted deploy (exit 1)" is "$RC" 1
check "after SIGKILL: the dry run says RECOVER" contains "$T/out" "RECOVER"
check "after SIGKILL: the dry run touches nothing" cmp -s "$T/before" "$T/after"
docker_before=$(lines "$STUB/docker.log") fi_before=$(lines "$STUB/from-image.log")
ship "$B"
check "after SIGKILL: the next run exits 1" is "$RC" 1
check "after SIGKILL: it pauses with the reason" contains "$PAUSE" "reason: smoke red on $B12: interrupted: the run was killed"
check "after SIGKILL: it rolls back to state.json's image, after writing the pause" \
  is "$(from_image_since "$fi_before")" "loop-lab-attendance:$A12 paused;"
check "after SIGKILL: A is live again" is "$(live)" "loop-lab-attendance:$A12"
check "after SIGKILL: it builds nothing" is "$(lines "$STUB/docker.log")" "$docker_before"
check "after SIGKILL: the marker is gone" test ! -e "$INFLIGHT"
check "after SIGKILL: ledger test_fail, blocked, decision_needed" is "$(events_since "$n")" "test_fail blocked decision_needed "
check "after SIGKILL: the pause file names the decision" contains "$PAUSE" "decision: $(last_did)"
ship "$B"
check "after SIGKILL and recovery, the next run refuses (exit 3)" is "$RC" 3
rm -f "$PAUSE"

echo "== SIGKILL during git:from-image of B"
: >"$STUB/from-image-hang-$B12"; rm -f "$STUB/from-image-started" "$STUB/from-image-pid"
ship_bg "$B"
if wait_for "$STUB/from-image-started"; then kill -KILL "$PID"; fi
wait "$PID" 2>/dev/null
kill "$(cat "$STUB/from-image-pid" 2>/dev/null || echo 999999)" 2>/dev/null
rm -f "$STUB/from-image-hang-$B12"
for _ in $(seq 1 100); do flock -n "$REPO/loop/deploy/.lock" true && break; sleep 0.1; done
rm -rf "$T"/tmp/loop-ship.*
check "SIGKILL during git:from-image: the marker was written before it ran" \
  is "$(jq -r '"\(.sha) \(.stage)"' "$INFLIGHT" 2>/dev/null)" "$B deploy"
ship "$B"
check "SIGKILL during git:from-image: the next run pauses and exits 1" is "$RC|$(test -f "$PAUSE" && echo paused)" "1|paused"
check "SIGKILL during git:from-image: it names the deploy step" contains "$PAUSE" "reason: deploy red on $B12: interrupted: the run was killed"
check "SIGKILL during git:from-image: A is live again" is "$(live)" "loop-lab-attendance:$A12"
rm -f "$PAUSE"

# ---- 14. state.json cannot be written on green -----------------------------------
echo "== green checks on B, but state.json cannot be written"
mkdir "$STATE.tmp"
n=$(lines "$STUB/ledger.jsonl") tags_before=$(g tag -l 'deploy/*' | wc -l | tr -d ' ')
ship "$B"
rmdir "$STATE.tmp"
check "state write failure: exits 1" is "$RC" 1
check "state write failure: pauses with the reason" contains "$PAUSE" "reason: state write failed on $B12; live is loop-lab-attendance:$B12"
check "state write failure: the green release is not rolled back" is "$(live)" "loop-lab-attendance:$B12"
check "state write failure: state.json still names A" is "$(jq -r .sha "$STATE")" "$A"
check "state write failure: ledger blocked, decision_needed (no deployed)" is "$(events_since "$n")" "blocked decision_needed "
check "state write failure: the blocked detail says what is live" contains "$STUB/ledger.jsonl" "deploy paused: state write failed on $B12; live is loop-lab-attendance:$B12"
check "state write failure: no new tag" is "$(g tag -l 'deploy/*' | wc -l | tr -d ' ')" "$tags_before"
check "state write failure: no in-flight marker" test ! -e "$INFLIGHT"
echo "loop-lab-attendance:$A12" >"$STUB/live"   # the holder puts production back by hand
rm -f "$PAUSE"

# ---- 15. a linked worktree uses the main checkout's pause, lock and state ---------
echo "== from a linked worktree"
g worktree add -q --detach "$T/wt" "$B"
printf 'paused by the test\n' >"$PAUSE"
SHIP_SCRIPT="$T/wt/loop/deploy/ship.sh" ship "$B"
check "worktree: a real run sees the main checkout's pause (exit 3)" is "$RC" 3
SHIP_SCRIPT="$T/wt/loop/deploy/ship.sh" ship "$B" --dry-run
check "worktree: a dry run sees it too (exit 3)" is "$RC" 3
rm -f "$PAUSE"
exec 8>"$REPO/loop/deploy/.lock"; flock 8
SHIP_SCRIPT="$T/wt/loop/deploy/ship.sh" ship "$B"
exec 8>&-
check "worktree: the main checkout's lock holds (exit 4)" is "$RC" 4
SHIP_SCRIPT="$T/wt/loop/deploy/ship.sh" ship "$B" --dry-run
check "worktree: the dry run plans a rollback to the main checkout's state (A)" contains "$T/out" "redeploy loop-lab-attendance:$A12"
check "worktree: the dry run says the state lives in the main checkout" contains "$T/out" "in the main checkout"
check "worktree: no lock or state inside the worktree" test ! -e "$T/wt/loop/deploy/.lock" -a ! -e "$T/wt/loop/deploy/state.json"

# ---- 16. --allow-no-version: a version-less health is green, and logged so -------
echo "== green deploy of B with --allow-no-version"
echo noversion >"$STUB/health-mode-$B12"
ship "$B" --allow-no-version
rm -f "$STUB/health-mode-$B12"
check "--allow-no-version: exits 0" is "$RC" 0
check "--allow-no-version: the deployed detail says version not checked" is "$(last_detail deployed)" "$URL $B12 (version not checked)"
check "--allow-no-version: state.json names B" is "$(jq -r .sha "$STATE")" "$B"

# ---- 17. only pushed commits ship ------------------------------------------------
echo "== an unpushed commit C"
printf 'committed C\n' >"$REPO/apps/attendance/marker.txt"
g commit -qam "commit C"
C=$(g rev-parse HEAD) C12=${C:0:12}
before="$(lines "$STUB/docker.log") $(lines "$STUB/ssh.log") $(lines "$STUB/curl.log") $(lines "$STUB/ledger.jsonl")"
ship "$C"
check "unpushed: a real run refuses (exit 2)" is "$RC" 2
check "unpushed: the refusal names origin/main" contains "$T/out" "$C12 is not on origin/main"
check "unpushed: nothing is built, shipped or logged" \
  is "$(lines "$STUB/docker.log") $(lines "$STUB/ssh.log") $(lines "$STUB/curl.log") $(lines "$STUB/ledger.jsonl")" "$before"
ship "$C" --dry-run
check "unpushed: the dry run refuses too (exit 2)" is "$RC" 2
check "unpushed: the dry run says REFUSE" contains "$T/out" "REFUSE   $C12 is not on origin/main"
ship "$C" --allow-unpushed
check "unpushed + --allow-unpushed: exits 0" is "$RC" 0
check "unpushed + --allow-unpushed: the deployed detail records it" \
  is "$(last_detail deployed)" "$URL $C12 (not on origin/main, shipped with --allow-unpushed)"
g push -q origin main
ship "$C" --dry-run
check "once pushed, the dry run plans it (exit 0)" is "$RC" 0

echo
echo "ship.test.sh: $npass PASS, $nfail FAIL"
[ "$nfail" -eq 0 ]
