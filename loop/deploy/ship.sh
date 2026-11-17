#!/usr/bin/env bash
# Ship one commit of attendance to production and check it after release (specs/prod-loop.md 4.1 steps 3-6, 4.2).
#
#   loop/deploy/ship.sh <git-ref> [--dry-run] [--allow-no-version] [--allow-unpushed]
#
# Steps: fetch origin main -> resolve <git-ref> to a sha and refuse it unless origin/main contains it -> export that
# commit (git archive, never the working tree) -> docker build -> docker save | $DEPLOY_SSH docker load
# -> write loop/deploy/inflight.json -> $DEPLOY_SSH dokku git:from-image -> wait until <PUBLIC_URL>/api/health is 200
# with "ok": true and version == <sha12> (90 s) -> apps/attendance/scripts/smoke-remote.sh <PUBLIC_URL>, from the export.
#   green: write loop/deploy/state.json, remove the in-flight marker, git tag deploy/<UTC ts>,
#          ledger deployed "<url> <sha12>", one fleet deployments line.
#   red:   write loop/.deploy-paused first, then redeploy the previous image from state.json, open a decision in
#          loop/decisions.md, ledger test_fail, blocked and decision_needed "<D-id>: ...", and exit 1.
#
# --dry-run          print the plan and touch nothing (no lock, fetch, temp dir, docker, ssh, curl, ledger or decision).
# --allow-no-version accept a health 200 with "ok": true but no version field. Only for deploys before P01 (T16): the
#                    route does not report a version yet. A wrong version is always red. Ledger details then say
#                    "version not checked".
# --allow-unpushed   ship a commit that origin/main does not contain; the ledger details say so. Without it only pushed
#                    commits ship, so production runs a sha the public repo has and the team can accept that version.
#
# Interruptions. Production is touched from `dokku git:from-image` on. From there, SIGTERM, SIGINT or SIGHUP stops the
# running step and counts as a red check of that stage: pause, roll back, decision, exit 1. SIGKILL cannot be trapped,
# so loop/deploy/inflight.json is written just before git:from-image and removed only once state.json names the new
# image (or the pause file has taken over). A later start that finds it pauses, rolls back to the image in state.json,
# opens a decision and exits 1. A run can take more than 10 minutes (build, ship, Dokku, up to 90 s of health, up to
# 600 s of smoke), so callers run it detached (run_in_background, nohup or cron), never under a short foreground
# timeout. The lock stays held until every process the run started has exited.
#
# Runtime files live in the main checkout, also when this copy runs from a linked worktree: loop/deploy/state.json,
# loop/deploy/inflight.json, loop/deploy/.lock, loop/.deploy-paused. Deploy from one clone per host: a second clone
# would have its own lock and state.
#
# Config: ${LOOP_DEPLOY_ENV:-~/.config/loop-lab/deploy.env}, never a file inside the repo. KEY=value lines; the
# file is parsed, never sourced, and only these keys are read: DEPLOY_SSH DOKKU_APP PUBLIC_URL IMAGE_REPO
# FLEET_DEPLOYMENTS_LOG (optional). See loop/deploy/deploy.env.example. The app's own env lives in the Dokku
# config; this script never reads or prints it, and never prints DEPLOY_SSH (it names a host).
# Env overrides, for the tests: LOOP_LOG_EVENT (ledger writer, default loop/log-event.sh), LOOP_DECISIONS (default
# loop/decisions.md), SHIP_HEALTH_TIMEOUT (s, default 90), SHIP_HEALTH_INTERVAL (s, default 3),
# SHIP_SMOKE_TIMEOUT (s, default 600), SHIP_DEPLOY_TIMEOUT (s per dokku git:from-image, default 600).
#
# Exit: 0 live (or a dry-run plan with nothing to refuse) · 1 red: production was rolled back when possible and the
#       loop is paused; or the build or ship failed before production was touched (no pause) · 2 usage, config or
#       preflight error, including a commit that origin/main does not contain · 3 paused (loop/.deploy-paused)
#       · 4 another deploy holds the lock
set -uo pipefail

say() { printf 'ship: %s\n' "$*"; }
warn() { printf 'ship: warning: %s\n' "$*" >&2; }
die() { printf 'ship: %s\n' "$1" >&2; exit "${2:-2}"; }
# shellcheck disable=SC2088  # a literal "~/" is the point: printed paths never name the home directory
tilde() { case "$1" in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }
usage() { sed -n '4p' "${BASH_SOURCE[0]}" | sed 's/^# *//' >&2; exit 2; }

# ---- args --------------------------------------------------------------------
REF="" DRY=0 LOOSE_VERSION=0 ALLOW_UNPUSHED=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --allow-no-version) LOOSE_VERSION=1 ;;
    --allow-unpushed) ALLOW_UNPUSHED=1 ;;
    -h|--help) usage ;;
    -*) echo "ship: unknown option '$a'" >&2; usage ;;
    *) [ -z "$REF" ] || usage; REF=$a ;;
  esac
done
[ -n "$REF" ] || usage
command -v git >/dev/null 2>&1 || die "git is missing"
command -v jq >/dev/null 2>&1 || die "jq is missing"

# ---- paths: always the main checkout's, also from a linked worktree ----------
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
common=$(git -C "$SCRIPT_ROOT" rev-parse --git-common-dir 2>/dev/null) || die "$(tilde "$SCRIPT_ROOT") is not a git checkout"
common=$(cd "$SCRIPT_ROOT" && cd "$common" && pwd -P) || die "cannot resolve the git common dir of $(tilde "$SCRIPT_ROOT")"
[ "${common##*/}" = .git ] || die "cannot find the main checkout: the git common dir $(tilde "$common") is not a .git directory"
ROOT=${common%/.git}
STATE="$ROOT/loop/deploy/state.json"
INFLIGHT="$ROOT/loop/deploy/inflight.json"
PAUSE="$ROOT/loop/.deploy-paused"
LOCK="$ROOT/loop/deploy/.lock"
LOG_EVENT="${LOOP_LOG_EVENT:-$ROOT/loop/log-event.sh}"
DECISIONS="${LOOP_DECISIONS:-$ROOT/loop/decisions.md}"
CFG="${LOOP_DEPLOY_ENV:-$HOME/.config/loop-lab/deploy.env}"
DOCKERFILE_REL="apps/attendance/Dockerfile"
CONTEXT_REL="apps/attendance"
SMOKE_REL="apps/attendance/scripts/smoke-remote.sh"
HEALTH_TIMEOUT=${SHIP_HEALTH_TIMEOUT:-90}   # seconds (spec 4.1 step 4)
HEALTH_INTERVAL=${SHIP_HEALTH_INTERVAL:-3}
SMOKE_TIMEOUT=${SHIP_SMOKE_TIMEOUT:-600}    # a hung smoke counts as red
DEPLOY_TIMEOUT=${SHIP_DEPLOY_TIMEOUT:-600}  # a hung dokku git:from-image counts as red
for v in HEALTH_TIMEOUT SMOKE_TIMEOUT DEPLOY_TIMEOUT; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || die "SHIP_$v must be whole seconds"
done
[[ "$HEALTH_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "SHIP_HEALTH_INTERVAL must be a number of seconds"

# ---- lock + pause (spec 4.1 step 6, 4.2) -------------------------------------
if [ "$DRY" -eq 0 ]; then
  command -v flock >/dev/null 2>&1 || die "flock is missing"
  mkdir -p "$ROOT/loop/deploy" || die "cannot create $(tilde "$ROOT/loop/deploy")"
  exec 9>"$LOCK" || die "cannot open $(tilde "$LOCK")"
  flock -n 9 || die "another deploy holds $(tilde "$LOCK"); not starting a second one" 4
fi
if [ -e "$PAUSE" ]; then
  echo "ship: PAUSED: $(tilde "$PAUSE") exists, so nothing is built or shipped. Only the loop holder deletes it, after answering the decision." >&2
  sed 's/^/ship:   /' "$PAUSE" >&2 2>/dev/null || true
  if [ -e "$INFLIGHT" ]; then
    echo "ship:   $(tilde "$INFLIGHT") is there too: a run was killed mid-deploy. Delete it once you know what is live; otherwise the first run after the pause rolls back to the image in state.json and pauses again." >&2
  fi
  exit 3
fi

# ---- config (parsed, never sourced) ------------------------------------------
[ -f "$CFG" ] || die "no deploy config at $(tilde "$CFG") (copy loop/deploy/deploy.env.example there, mode 600)"
cfg_real=$(realpath -e "$CFG" 2>/dev/null) || die "cannot resolve $(tilde "$CFG")"
for r in "$ROOT" "$SCRIPT_ROOT"; do
  case "$cfg_real/" in "$r"/*) die "the deploy config must live outside the repo, not at $(tilde "$cfg_real")" ;; esac
done
DEPLOY_SSH="" DOKKU_APP="" PUBLIC_URL="" IMAGE_REPO="" FLEET_DEPLOYMENTS_LOG=""
while IFS= read -r line || [ -n "$line" ]; do
  line=${line#"${line%%[![:space:]]*}"}
  case "$line" in ''|'#'*) continue ;; esac
  line=${line#export }
  key=${line%%=*} val=${line#*=}
  [ "$key" != "$line" ] || continue
  case "$key" in DEPLOY_SSH|DOKKU_APP|PUBLIC_URL|IMAGE_REPO|FLEET_DEPLOYMENTS_LOG) ;; *) continue ;; esac
  val=${val%"${val##*[![:space:]]}"}
  case "$val" in \"*\"|\'*\') val=${val:1:${#val}-2} ;; esac
  printf -v "$key" '%s' "$val"
done <"$CFG"
unset line key val
[ -n "$DEPLOY_SSH" ] || die "DEPLOY_SSH is not set in $(tilde "$CFG")"
read -r -a SSH <<<"$DEPLOY_SSH"
[[ "$DOKKU_APP" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "DOKKU_APP must be a Dokku app name (a-z 0-9 -)"
[[ "$IMAGE_REPO" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || die "IMAGE_REPO must be a lowercase docker repository name"
PUBLIC_URL=${PUBLIC_URL%/}
[[ "$PUBLIC_URL" =~ ^https?://[^[:space:]/]+(/[^[:space:]]*)?$ ]] || die "PUBLIC_URL must be an http(s) URL"
# shellcheck disable=SC2088  # expand a literal leading "~/" from the config file
case "$FLEET_DEPLOYMENTS_LOG" in "~/"*) FLEET_DEPLOYMENTS_LOG="$HOME/${FLEET_DEPLOYMENTS_LOG#"~/"}" ;; esac

if [ "$DRY" -eq 0 ]; then
  for c in docker curl tar timeout; do command -v "$c" >/dev/null 2>&1 || die "$c is missing"; done
fi

# ---- what is live, according to state.json -----------------------------------
PREV_SHA="" PREV_IMAGE=""
if [ -e "$STATE" ]; then
  if ! PREV_SHA=$(jq -er '.sha // ""' "$STATE" 2>/dev/null) || ! PREV_IMAGE=$(jq -er '.image // ""' "$STATE" 2>/dev/null); then
    die "$(tilde "$STATE") exists but is not valid JSON; fix or remove it by hand (it names the live image)"
  fi
fi
PREV_SHA12=${PREV_SHA:0:12}
[ -n "$PREV_SHA12" ] || PREV_SHA12=${PREV_IMAGE##*:}

# ---- run state ---------------------------------------------------------------
SHA="" SHA12="" IMAGE="" STAGE="" CHILD="" WORK=""
IN_RED=0 INTERRUPTED=0 UNPUSHED=0 VERSION_UNCHECKED=0 ROLLBACK_OK=0
HEALTH_NOTE="" HEALTH_LOOSE_HIT=0
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log_event() { # <event> <detail> [task, default <sha12>]
  if [ -x "$LOG_EVENT" ]; then
    "$LOG_EVENT" deploy attendance "${3:-$SHA12}" "$1" "$2" "$SHA12" || warn "ledger write failed ($1)"
  else
    warn "$(tilde "$LOG_EVENT") is not executable; ledger event $1 not written"
  fi
}

notes() { # " (version not checked; ...)" for ledger details, or nothing
  local n=""
  [ "$VERSION_UNCHECKED" -eq 0 ] || n="version not checked"
  [ "$UNPUSHED" -eq 0 ] || n="${n:+$n; }not on origin/main, shipped with --allow-unpushed"
  [ -z "$n" ] || printf ' (%s)' "$n"
}

next_decision_id() {
  local n
  n=$(grep -oE '^## D-[0-9]+' "$DECISIONS" 2>/dev/null | sed 's/^## D-//' | sort -n | tail -n 1)
  printf 'D-%03d' $((10#${n:-0} + 1))
}

# shellcheck disable=SC2094  # reads the last byte, then appends, both under the flock on the same file
open_decision() { # <title> <context> <options> <recommendation>; prints the new D-id
  [ -f "$DECISIONS" ] || { warn "$(tilde "$DECISIONS") not found; no decision opened"; return 1; }
  local id sep=""
  {
    flock -w 5 7 || true
    id=$(next_decision_id)
    [ -z "$(tail -c 1 "$DECISIONS")" ] || sep=$'\n'
    printf '%s\n## %s · DEPLOY · %s\n- app: attendance | status: OPEN\n- context: %s\n- options: %s\n- recommendation: %s\n- answer: _(loop holder writes here)_\n' \
      "$sep" "$id" "$1" "$2" "$3" "$4" >&7
  } 7>>"$DECISIONS" || { warn "could not append to $(tilde "$DECISIONS")"; return 1; }
  printf '%s' "$id"
}

write_pause() { # <reason> <rollback> <decision>
  local clear="the decision"
  [[ "$3" =~ ^D-[0-9]+$ ]] && clear="$3 in loop/decisions.md"
  {
    printf 'paused_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'sha: %s\n' "$SHA"
    printf 'image: %s\n' "$IMAGE"
    printf 'previous: %s\n' "${PREV_IMAGE:-none}"
    printf 'reason: %s\n' "$1"
    printf 'rollback: %s\n' "$2"
    printf 'decision: %s\n' "$3"
    printf 'clear: the loop holder deletes this file after answering %s (specs/prod-loop.md 4.1 step 6)\n' "$clear"
  } >"$PAUSE" 2>/dev/null || { warn "could not write $(tilde "$PAUSE")"; return 1; }
}

write_marker() { # <stage>: what an interrupted run leaves behind for the next start
  jq -n --arg sha "$SHA" --arg image "$IMAGE" --arg prev "$PREV_IMAGE" --arg stage "$1" --arg at "$STARTED_AT" \
    '{sha: $sha, image: $image, prev_image: $prev, stage: $stage, started_at: $at}' >"$INFLIGHT.tmp" 2>/dev/null &&
    mv -f "$INFLIGHT.tmp" "$INFLIGHT"
}
set_stage() { STAGE=$1; write_marker "$1" || warn "could not update $(tilde "$INFLIGHT") to stage $1"; }

# Long steps run in the background with `wait`, so a trapped signal is handled at once, not after the step ends.
# `timeout -k 10` bounds each one, also after the TERM that stop_child sends.
run_child() { # <dir> <seconds> <command...>
  local dir=$1 secs=$2 rc
  shift 2
  (cd "$dir" && exec timeout -k 10 "$secs" "$@") &
  CHILD=$!
  wait "$CHILD"
  rc=$?
  CHILD=""
  return "$rc"
}
# shellcheck disable=SC2317  # stop_child and on_signal run from the signal traps
stop_child() {
  [ -n "$CHILD" ] || return 0
  kill -TERM "$CHILD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  CHILD=""
}
# shellcheck disable=SC2317
on_signal() { # <TERM|INT|HUP>
  if [ "$IN_RED" -eq 1 ]; then warn "SIG$1 received; the pause and the rollback finish first"; return 0; fi
  IN_RED=1 INTERRUPTED=1
  stop_child
  red "$STAGE" "interrupted by SIG$1 before the $STAGE step finished"
}
trap_signals() { trap 'on_signal TERM' TERM; trap 'on_signal INT' INT; trap 'on_signal HUP' HUP; }

wait_health() { # <want sha12> <want full sha>; sets HEALTH_NOTE and HEALTH_LOOSE_HIT
  local want=$1 full=$2 code ok ver deadline=$(($(date +%s) + HEALTH_TIMEOUT))
  HEALTH_LOOSE_HIT=0
  while :; do
    code=$(curl -sS -o "$WORK/health.json" -w '%{http_code}' --max-time 10 "$PUBLIC_URL/api/health" 2>/dev/null) || code=000
    if [ "$code" = 200 ]; then
      ok=$(jq -r 'if type == "object" and .ok == true then "yes" else "no" end' "$WORK/health.json" 2>/dev/null) || ok=no
      ver=$(jq -r 'if type == "object" then (.version // "" | tostring) else "" end' "$WORK/health.json" 2>/dev/null) || ver=""
      ver=$(printf '%s' "$ver" | tr -cd 'A-Za-z0-9._-' | cut -c 1-40)
      if [ "$ok" != yes ]; then
        HEALTH_NOTE='200 but the body has no "ok": true'
      elif [ -z "$ver" ]; then
        if [ "$LOOSE_VERSION" -eq 1 ]; then
          HEALTH_NOTE="200 and ok, version not checked (no version field; --allow-no-version)"
          HEALTH_LOOSE_HIT=1
          return 0
        fi
        HEALTH_NOTE="200 and ok, but no version field, so it is not known to run $want"
      elif [ "$ver" = "$want" ] || [ "$ver" = "$full" ]; then
        HEALTH_NOTE="200, ok, version $ver"
        return 0
      else
        HEALTH_NOTE="200 but version $ver, not $want"
      fi
    else
      HEALTH_NOTE="HTTP $code"
    fi
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep "$HEALTH_INTERVAL"
  done
}

# Production was touched and is red (or was interrupted): pause, roll back, open a decision, log, exit 1.
red() { # <stage> <what failed>
  IN_RED=1
  trap_signals # from here a signal only warns: the pause and the rollback finish
  local stage=$1 reason="$1 red on $SHA12: $2" rollback="in progress" rc did title context options rec
  say "RED: $reason"
  # Pause first, so a crash during the rollback still stops the loop. The pause file then holds what the marker knew.
  if write_pause "$reason" "$rollback" "(not opened yet)"; then rm -f "$INFLIGHT"; fi
  log_event test_fail "$PUBLIC_URL $SHA12 $stage red: $2$(notes)"
  if [ -n "$PREV_IMAGE" ] && [ "$PREV_IMAGE" != "$IMAGE" ]; then
    say "rolling back to $PREV_IMAGE"
    timeout -k 10 "$DEPLOY_TIMEOUT" "${SSH[@]}" dokku git:from-image "$DOKKU_APP" "$PREV_IMAGE" </dev/null
    rc=$?
    if [ "$rc" -ne 0 ]; then
      rollback="rollback to $PREV_IMAGE FAILED (dokku git:from-image exit $rc)"
    elif wait_health "$PREV_SHA12" "$PREV_SHA"; then
      rollback="rolled back to $PREV_IMAGE (health: $HEALTH_NOTE)"
      ROLLBACK_OK=1
    else
      rollback="rolled back to $PREV_IMAGE, but its health is not green after ${HEALTH_TIMEOUT} s ($HEALTH_NOTE)"
    fi
  else
    rollback="no previous image to roll back to${PREV_IMAGE:+ (state.json already names $IMAGE)}"
  fi
  say "$rollback"

  if [ "$INTERRUPTED" -eq 1 ]; then
    title="Deploy of $SHA12 was interrupted during its $stage step, and deploys are paused. How does the loop resume?"
    rec="B. The run was stopped from outside, so no check failed on its own. Run it again detached (nohup or run_in_background)."
  else
    title="Deploy of $SHA12 failed its $stage check, and deploys are paused. How does the loop resume?"
    rec="A. A check that fails after release found something the build oracle missed."
  fi
  [ "$ROLLBACK_OK" -eq 1 ] || rec="$rec First check by hand what is live: the rollback did not end green."
  context="loop/deploy/ship.sh ran dokku git:from-image with $IMAGE for $PUBLIC_URL (run started $STARTED_AT). Reason: $reason$(notes). Rollback: $rollback. No deploy runs while loop/.deploy-paused exists (specs/prod-loop.md 4.1 step 6)."
  options="A) Fix forward: keep the pause until a fix for this failure is on main, with a test that would have caught it in CI (specs/prod-loop.md 4.4), then delete loop/.deploy-paused. B) Retry as is: delete loop/.deploy-paused now, and the next deploy runs the same checks on $SHA12 again."
  did=$(open_decision "$title" "$context" "$options" "$rec") || did=""
  write_pause "$reason" "$rollback" "${did:-(none: could not write $(tilde "$DECISIONS"))}"
  log_event blocked "deploy paused: $reason; $rollback; $PUBLIC_URL; ${did:-no decision opened}; the holder deletes loop/.deploy-paused$(notes)"
  [ -z "$did" ] || log_event decision_needed "$did: deploy of $SHA12 to $PUBLIC_URL is paused ($stage red). Answer in loop/decisions.md." "$did"
  exit 1
}

# Every check is green, but state.json could not be written: a later rollback would go to an older image. Pause.
record_fail() {
  local reason rollback="none: $IMAGE passed its checks, so it stays live" did context options
  reason="state write failed on $SHA12; live is $IMAGE (health and smoke green), but loop/deploy/state.json still names ${PREV_IMAGE:-no image}"
  say "RED: $reason"
  if write_pause "$reason" "$rollback" "(not opened yet)"; then rm -f "$INFLIGHT"; fi
  context="$IMAGE passed health ($HEALTH_NOTE) and smoke-remote.sh on $PUBLIC_URL$(notes), but ship.sh could not write loop/deploy/state.json, which still names ${PREV_IMAGE:-no image}. A later red deploy would roll back to that image. No deploy tag and no deployed event were written."
  options="A) Fix why the write failed, write loop/deploy/state.json by hand as {sha, image, url, deployed_at} for $SHA, then delete loop/.deploy-paused. B) Fix why the write failed, delete loop/.deploy-paused, and run loop/deploy/ship.sh $SHA12 again."
  did=$(open_decision "Deploy of $SHA12 is live and green, but state.json was not written. Deploys are paused. How does the loop resume?" \
    "$context" "$options" "A. The release is green; only its record is missing, and a full redeploy could hit the same write failure.") || did=""
  write_pause "$reason" "$rollback" "${did:-(none: could not write $(tilde "$DECISIONS"))}"
  log_event blocked "deploy paused: $reason; $PUBLIC_URL; ${did:-no decision opened}; the holder deletes loop/.deploy-paused$(notes)"
  [ -z "$did" ] || log_event decision_needed "$did: $SHA12 is live at $PUBLIC_URL but state.json was not written; deploys are paused. Answer in loop/decisions.md." "$did"
  exit 1
}

# Before production is touched: nothing to roll back, no pause.
early_fail() { # <what failed>
  say "FAIL before release: $1 (production untouched)"
  log_event test_fail "$PUBLIC_URL $SHA12 $1 (production untouched)"
  exit 1
}

if [ "$DRY" -eq 0 ]; then
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/loop-ship.XXXXXX") || die "mktemp failed"
  trap 'rm -rf "$WORK"' EXIT
fi

# ---- a run that was killed after production was touched ---------------------
if [ -e "$INFLIGHT" ]; then
  m_sha=$(jq -r '.sha // ""' "$INFLIGHT" 2>/dev/null) || m_sha=""
  m_image=$(jq -r '.image // ""' "$INFLIGHT" 2>/dev/null) || m_image=""
  m_stage=$(jq -r '.stage // ""' "$INFLIGHT" 2>/dev/null) || m_stage=""
  m_at=$(jq -r '.started_at // ""' "$INFLIGHT" 2>/dev/null) || m_at=""
  if [ -n "$m_sha" ] && [ "$m_sha" = "$PREV_SHA" ]; then
    # killed between writing state.json and removing the marker: that release was green and is recorded
    if [ "$DRY" -eq 1 ]; then
      say "note: $(tilde "$INFLIGHT") names ${m_sha:0:12}, which state.json already records as live; a real run removes it"
    else
      rm -f "$INFLIGHT"
      say "note: removed $(tilde "$INFLIGHT"): state.json already records ${m_sha:0:12} as live"
    fi
  else
    SHA=$m_sha SHA12=${m_sha:0:12} IMAGE=${m_image:-unknown} STAGE=${m_stage:-unknown} INTERRUPTED=1
    [ -n "$SHA12" ] || SHA12=unknown
    [ -z "$m_at" ] || STARTED_AT=$m_at
    if [ "$DRY" -eq 1 ]; then
      say "RECOVER  $(tilde "$INFLIGHT"): a run deploying $SHA12 was killed during its $STAGE step."
      say "         A real run writes $(tilde "$PAUSE"), redeploys ${PREV_IMAGE:-nothing (state.json names no image)}, opens $(next_decision_id) and exits 1. Nothing else is planned."
      exit 1
    fi
    red "$STAGE" "interrupted: the run was killed during this step and could not roll back (found loop/deploy/inflight.json at the next start)"
  fi
fi

# ---- resolve the ref; only pushed commits ship -------------------------------
if [ "$DRY" -eq 0 ]; then
  if ! GIT_TERMINAL_PROMPT=0 timeout 120 git -C "$ROOT" fetch --quiet origin "+refs/heads/main:refs/remotes/origin/main" </dev/null >/dev/null 2>&1; then
    [ "$ALLOW_UNPUSHED" -eq 1 ] || die "could not fetch origin main, so there is no way to check that '$REF' is pushed; nothing was deployed"
    warn "could not fetch origin main; going on because of --allow-unpushed"
  fi
fi
SHA=$(git -C "$SCRIPT_ROOT" rev-parse --verify --quiet "${REF}^{commit}") || die "'$REF' is not a commit in this repo"
SHA12=${SHA:0:12}
IMAGE="$IMAGE_REPO:$SHA12"
SUBJECT=$(git -C "$SCRIPT_ROOT" log -1 --format=%s "$SHA")
git -C "$ROOT" merge-base --is-ancestor "$SHA" refs/remotes/origin/main 2>/dev/null || UNPUSHED=1
if [ "$UNPUSHED" -eq 1 ] && [ "$ALLOW_UNPUSHED" -eq 0 ] && [ "$DRY" -eq 0 ]; then
  die "$SHA12 is not on origin/main. Only pushed commits ship, so production always runs a sha the public repo has. Push it first, or pass --allow-unpushed (the ledger records it)."
fi

missing=()
git -C "$SCRIPT_ROOT" cat-file -e "$SHA:$DOCKERFILE_REL" 2>/dev/null || missing+=("$DOCKERFILE_REL")
git -C "$SCRIPT_ROOT" cat-file -e "$SHA:$SMOKE_REL" 2>/dev/null || missing+=("$SMOKE_REL")

# ---- dry run -----------------------------------------------------------------
if [ "$DRY" -eq 1 ]; then
  say "plan (dry run: nothing is fetched, built, shipped, deployed, written, tagged, logged or opened)"
  say "  ref      $REF -> $SHA"
  say "  commit   $SUBJECT"
  say "  config   $(tilde "$CFG")"
  [ "$ROOT" = "$SCRIPT_ROOT" ] || say "  state    in the main checkout $(tilde "$ROOT") (this copy runs from a linked worktree)"
  say "  lock     flock $(tilde "$LOCK") (not taken in a dry run)"
  if [ "$UNPUSHED" -eq 0 ]; then
    say "  pushed   origin/main contains $SHA12 (local ref; a real run fetches first)"
  elif [ "$ALLOW_UNPUSHED" -eq 1 ]; then
    say "  pushed   NO: origin/main does not contain $SHA12; --allow-unpushed ships it anyway and the ledger says so"
  else
    say "  pushed   NO: origin/main does not contain $SHA12 (local ref, not fetched in a dry run)"
  fi
  say "  1 export git archive $SHA12 -> a temp dir (never the working tree)"
  say "  2 build  docker build --build-arg GIT_SHA=$SHA -t $IMAGE -f <export>/$DOCKERFILE_REL <export>/$CONTEXT_REL"
  say "  3 ship   docker save $IMAGE | \$DEPLOY_SSH docker load"
  say "  4 deploy write $(tilde "$INFLIGHT"), then \$DEPLOY_SSH dokku git:from-image $DOKKU_APP $IMAGE (up to ${DEPLOY_TIMEOUT} s)"
  if [ "$LOOSE_VERSION" -eq 1 ]; then
    say "  5 health GET $PUBLIC_URL/api/health -> 200, ok true, version == $SHA12, up to ${HEALTH_TIMEOUT} s; no version field is accepted (--allow-no-version) and logged as not checked"
  else
    say "  5 health GET $PUBLIC_URL/api/health -> 200, ok true, version == $SHA12, up to ${HEALTH_TIMEOUT} s"
  fi
  say "  6 smoke  bash $SMOKE_REL $PUBLIC_URL (from the export, up to ${SMOKE_TIMEOUT} s)"
  say "  green    write $(tilde "$STATE"), remove the marker, tag deploy/<UTC yyyymmddThhmmssZ>, ledger deployed \"$PUBLIC_URL $SHA12\"${FLEET_DEPLOYMENTS_LOG:+, one fleet deployments line}"
  if [ -n "$PREV_IMAGE" ] && [ "$PREV_IMAGE" != "$IMAGE" ]; then
    say "  red      write $(tilde "$PAUSE") first, redeploy $PREV_IMAGE, open $(next_decision_id) in $(tilde "$DECISIONS"), ledger test_fail + blocked + decision_needed"
  else
    say "  red      write $(tilde "$PAUSE"); no older image to roll back to${PREV_IMAGE:+ (state.json already names $IMAGE)}; open $(next_decision_id) in $(tilde "$DECISIONS"), ledger test_fail + blocked + decision_needed"
  fi
  rc=0
  if [ "${#missing[@]}" -gt 0 ]; then
    say "  REFUSE   commit $SHA12 has no ${missing[*]}; a real run stops before building"
    rc=2
  fi
  if [ "$UNPUSHED" -eq 1 ] && [ "$ALLOW_UNPUSHED" -eq 0 ]; then
    say "  REFUSE   $SHA12 is not on origin/main; a real run fetches, then stops before building if it is still not there (push it, or pass --allow-unpushed)"
    rc=2
  fi
  exit "$rc"
fi

# ---- real run ----------------------------------------------------------------
[ "${#missing[@]}" -eq 0 ] || die "commit $SHA12 has no ${missing[*]}; not building it"
EXPORT="$WORK/src"
mkdir -p "$EXPORT"

say "deploying $REF -> $SHA12 ($SUBJECT) to $PUBLIC_URL"
[ "$ROOT" = "$SCRIPT_ROOT" ] || say "runtime state: the main checkout $(tilde "$ROOT") (this copy runs from a linked worktree)"
[ "$UNPUSHED" -eq 0 ] || warn "$SHA12 is not on origin/main; shipping it because of --allow-unpushed (the ledger records it)"
say "live now: ${PREV_IMAGE:-none recorded in state.json}"

# 1 export: only the committed tree, never the working tree
git -C "$SCRIPT_ROOT" archive --format=tar "$SHA" | tar -x -C "$EXPORT" || early_fail "git archive of $SHA12 failed"

# 2 build
say "building $IMAGE"
docker build --build-arg "GIT_SHA=$SHA" -t "$IMAGE" -f "$EXPORT/$DOCKERFILE_REL" "$EXPORT/$CONTEXT_REL" ||
  early_fail "docker build failed"

# 3 ship
say "shipping $IMAGE"
docker save "$IMAGE" | "${SSH[@]}" docker load || early_fail "docker save | docker load failed"

# 4 deploy + health. From here production is touched: the marker and the signal traps are in place first.
if ! write_marker deploy; then
  rm -f "$INFLIGHT.tmp"
  early_fail "could not write $(tilde "$INFLIGHT"), so a killed run could not be found later"
fi
STAGE=deploy
trap_signals
say "dokku git:from-image $DOKKU_APP $IMAGE"
run_child "$WORK" "$DEPLOY_TIMEOUT" "${SSH[@]}" dokku git:from-image "$DOKKU_APP" "$IMAGE"
rc=$?
[ "$rc" -eq 0 ] || red deploy "dokku git:from-image exit $rc"
set_stage health
say "waiting up to ${HEALTH_TIMEOUT} s for $PUBLIC_URL/api/health"
wait_health "$SHA12" "$SHA" || red health "$HEALTH_NOTE after ${HEALTH_TIMEOUT} s"
VERSION_UNCHECKED=$HEALTH_LOOSE_HIT
say "health: $HEALTH_NOTE"

# 5 smoke (the oracle from the same commit)
set_stage smoke
say "smoke: $SMOKE_REL $PUBLIC_URL"
run_child "$EXPORT" "$SMOKE_TIMEOUT" bash "$SMOKE_REL" "$PUBLIC_URL"
rc=$?
if [ "$rc" -eq 124 ]; then red smoke "smoke-remote.sh timed out after ${SMOKE_TIMEOUT} s"; fi
[ "$rc" -eq 0 ] || red smoke "smoke-remote.sh exit $rc"

# ---- green -------------------------------------------------------------------
set_stage record
trap '' TERM INT HUP # every check is green: finish the record rather than roll back a good release
now=$(date -u +%s)
at=$(date -u -d "@$now" +%Y-%m-%dT%H:%M:%SZ)
TAG="deploy/$(date -u -d "@$now" +%Y%m%dT%H%M%SZ)"
if ! { jq -n --arg sha "$SHA" --arg image "$IMAGE" --arg url "$PUBLIC_URL" --arg at "$at" \
  '{sha: $sha, image: $image, url: $url, deployed_at: $at}' >"$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"; }; then
  rm -f "$STATE.tmp" 2>/dev/null
  record_fail
fi
rm -f "$INFLIGHT"
trap - TERM INT HUP
git -C "$ROOT" tag "$TAG" "$SHA" || warn "could not create tag $TAG"
log_event deployed "$PUBLIC_URL $SHA12$(notes)"
if [ -n "$FLEET_DEPLOYMENTS_LOG" ]; then
  jq -nc --arg id "loop-lab-$DOKKU_APP-$SHA12-$(date -u -d "@$now" +%Y%m%d-%H%M)" --arg at "$at" \
    --arg title "$DOKKU_APP: ${SUBJECT:0:120}" --arg url "$PUBLIC_URL" \
    --arg expect "$REF $SHA12, image $IMAGE, tag $TAG. Health $HEALTH_NOTE; smoke-remote.sh green$(notes). Previous: ${PREV_IMAGE:-none}." \
    '{actor: "loop-lab-deploy", id: $id, at: $at, title: $title, url: $url, project: "loop-lab", signin: "-", status: "live", expect: $expect}' \
    >>"$FLEET_DEPLOYMENTS_LOG" || warn "could not append to the fleet deployments log"
fi
say "LIVE $PUBLIC_URL $SHA12 (tag $TAG)"
exit 0
