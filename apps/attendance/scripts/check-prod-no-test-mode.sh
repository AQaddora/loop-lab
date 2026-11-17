#!/usr/bin/env bash
# AC-36 prod guard (spec §7.4, TH-14). Exit 0 only if every check passes.
#  1. next build with AUTH_TEST_MODE unset, against a temp SQLite DB with migrations applied
#  2. AUTH_TEST_MODE=1 npm start must exit non-zero within 30 s (boot guard: scripts/assert-prod-env.mjs)
#  2b. AUTH_TEST_MODE=1 next start (npm guard bypassed) must not serve: instrumentation guard (D-001 A)
#  3. both guards bypassed (flag injected after boot, D-001 A): /api/test/* 404, no test-login provider,
#     GET /api/client-ip with x-test-client-ip: 198.51.100.23 does not return 198.51.100.23
#  4. kill the server
# Builds into .next-prodcheck so it never touches a real .next build.
set -uo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP" || exit 1
PORT="${PRODCHECK_PORT:-3200}"
BASE="http://127.0.0.1:${PORT}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/attendance-prodcheck.XXXXXX")"
LOG="$TMP/server.log"
SERVER_PID=""
FAILS=0

ok()   { echo "  ok   $*"; }
bad()  { echo "  FAIL $*"; FAILS=$((FAILS + 1)); }
die()  { echo "FATAL $*"; [ -f "$LOG" ] && tail -n 30 "$LOG"; cleanup; exit 1; }

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

stop_server() { # servers run in their own process group (setsid): stop the whole group
  if [ -n "$SERVER_PID" ]; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null
    for _ in $(seq 1 40); do kill -0 -- "-$SERVER_PID" 2>/dev/null || break; sleep 0.25; done
    kill -KILL -- "-$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=""
  for _ in $(seq 1 40); do port_free && return 0; sleep 0.25; done
  die "port $PORT still busy after stopping the server"
}
cleanup() { trap - EXIT INT TERM; [ -n "$SERVER_PID" ] && kill -KILL -- "-$SERVER_PID" 2>/dev/null; SERVER_PID=""; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

# prod-like env with throwaway values: these checks need no real secret
export NODE_ENV=production
export NEXT_DIST_DIR=.next-prodcheck
export DATABASE_URL="file:$TMP/prod.db"
export AUTH_URL="$BASE" AUTH_TRUST_HOST=true
export AUTH_SECRET="prodcheck-throwaway-auth-secret-000000000000"
export QR_SIGNING_SECRET="prodcheck-throwaway-qr-secret-0000000000000"
export LOG_CHAIN_KEY="prodcheck-throwaway-chain-key-0000000000000"
export WEBAUTHN_RP_ID=localhost WEBAUTHN_RP_NAME=Attendance WEBAUTHN_ORIGIN="$BASE"
export AUTH_GOOGLE_ID="prodcheck-dummy.apps.googleusercontent.com" AUTH_GOOGLE_SECRET="prodcheck-dummy"
# staging config (loop holder's decision): the client IP comes ONLY from one trusted proxy header.
export TRUSTED_IP_HEADER="x-real-ip" TRUSTED_PROXY_HOPS=1 BASE_PATH=""
unset AUTH_TEST_MODE PRODCHECK_LATE_FLAG

port_free || die "port $PORT is busy (set PRODCHECK_PORT)"

echo "1. build (AUTH_TEST_MODE unset) against a temp DB with migrations"
node node_modules/drizzle-kit/bin.cjs migrate >"$TMP/migrate.log" 2>&1 || { cat "$TMP/migrate.log"; die "migrations failed"; }
node node_modules/next/dist/bin/next build >"$TMP/build.log" 2>&1 || { tail -n 40 "$TMP/build.log"; die "next build failed"; }
ok "build + migrations"

echo "2. boot guard: AUTH_TEST_MODE=1 npm start must exit non-zero within 30 s"
node scripts/assert-prod-env.mjs >/dev/null 2>&1 && ok "control: guard passes without the flag" || bad "control: guard fails even without the flag"
AUTH_TEST_MODE=1 timeout 30 npm start -- -p "$PORT" >"$TMP/start.log" 2>&1
rc=$?
if [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ] && grep -q "AUTH_TEST_MODE" "$TMP/start.log"; then
  ok "npm start refused to boot (exit $rc)"
else
  bad "npm start with AUTH_TEST_MODE=1 exited $rc"; tail -n 10 "$TMP/start.log"
fi
port_free || bad "something is listening on $PORT after the refused start"

wait_listening() { # wait until the port answers anything
  for _ in $(seq 1 120); do
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    curl -s -o /dev/null --max-time 2 "$BASE/" && return 0
    sleep 0.5
  done
  return 1
}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

echo "2b. npm guard bypassed: AUTH_TEST_MODE=1 next start must not serve (instrumentation guard)"
AUTH_TEST_MODE=1 setsid node node_modules/next/dist/bin/next start -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
if wait_listening; then
  for p in /api/health /api/auth/providers /api/test/reset /api/client-ip; do
    c=$(code -H "x-test-client-ip: 198.51.100.23" "$BASE$p")
    case "$c" in 2*) bad "2b: $p answered $c with AUTH_TEST_MODE=1" ;; *) ok "2b: $p -> $c" ;; esac
  done
  grep -q "AUTH_TEST_MODE is set in a production server" "$LOG" && ok "2b: instrumentation guard logged" || bad "2b: no instrumentation guard log line"
else
  ok "2b: server did not come up"
fi
stop_server

echo "3. both guards bypassed (flag injected after boot): test surfaces must be dead code"
PRODCHECK_LATE_FLAG=1 NODE_OPTIONS="--require=$APP/scripts/prodcheck-late-flag.cjs" setsid node node_modules/next/dist/bin/next start -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
wait_listening || die "prod server did not start"
for _ in $(seq 1 60); do [ "$(code "$BASE/api/health")" = "200" ] && break; sleep 0.5; done
[ "$(code "$BASE/api/health")" = "200" ] && ok "health 200" || bad "health not 200"
grep -q "prodcheck: AUTH_TEST_MODE=1 injected" "$LOG" && ok "AUTH_TEST_MODE=1 is set inside the running server" || bad "flag injection did not happen"

for a in reset login clock qr tamper nonexistent; do
  for m in GET POST; do
    c=$(code -X "$m" -H 'content-type: application/json' -H "x-test-client-ip: 198.51.100.23" --data '{}' "$BASE/api/test/$a")
    [ "$m" = GET ] && c=$(code -H "x-test-client-ip: 198.51.100.23" "$BASE/api/test/$a")
    [ "$c" = "404" ] && ok "$m /api/test/$a -> 404" || bad "$m /api/test/$a -> $c (want 404)"
  done
done

providers=$(curl -s --max-time 10 "$BASE/api/auth/providers")
if printf '%s' "$providers" | grep -q '"google"' && ! printf '%s' "$providers" | grep -q 'test-login'; then
  ok "/api/auth/providers: google present, no test-login"
else
  bad "/api/auth/providers: $providers"
fi

seen=$(curl -s --max-time 10 -H "x-test-client-ip: 198.51.100.23" "$BASE/api/client-ip")
if printf '%s' "$seen" | grep -q '"ip"' && ! printf '%s' "$seen" | grep -q '198.51.100.23'; then
  ok "/api/client-ip ignores x-test-client-ip ($seen)"
else
  bad "/api/client-ip with x-test-client-ip: $seen"
fi
# positive control: the trusted proxy header IS read, so the check above is not vacuous
ctl=$(curl -s --max-time 10 -H "x-real-ip: 192.0.2.77" "$BASE/api/client-ip")
printf '%s' "$ctl" | grep -q '"192.0.2.77"' && ok "control: trusted header x-real-ip honoured" || bad "control: trusted header not honoured ($ctl)"

echo "4. stop the server"
stop_server

if [ "$FAILS" -eq 0 ]; then echo "check-prod-no-test-mode: PASS"; exit 0; fi
echo "check-prod-no-test-mode: FAIL ($FAILS)"; exit 1
