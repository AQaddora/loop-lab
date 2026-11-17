#!/usr/bin/env bash
# AC-39 remote smoke (spec §8 AC-39; specs/prod-loop.md §4.1 step 5). Checks a running deploy from outside.
#
#   scripts/smoke-remote.sh <url>        e.g. scripts/smoke-remote.sh "$(cat deploy/STAGING_URL)"
#
# One line per check: PASS | FAIL | ERROR | SKIP <check>: <reason>
#   health          GET /api/health -> 200 with "ok":true
#   version         only with --expect-version <sha>: /api/health reports "version" == the sha's first 12 chars
#   hsts           the URL is https and the response carries Strict-Transport-Security with max-age > 0
#   test-routes     GET and POST /api/test/{reset,login,clock,qr,tamper,<unknown>} -> 404
#                   (the POST body fails every test route's strict schema, so a live bypass changes nothing)
#   providers       /api/auth/providers lists no test-login provider
#   client-ip       a plain /api/client-ip (no spoofed header) returns an address, not null. With ip: null the
#                   spoof checks cannot judge anything, so it is ERROR
#   spoof <header>  /api/client-ip sent with X-Forwarded-For / X-Real-IP / CF-Connecting-IP / Fly-Client-IP,
#                   plus the test-mode x-test-client-ip, = 198.51.100.23 (one at a time, then all at once) does
#                   not return 198.51.100.23 (and does not return null)
#   origin-port     the app port ORIGIN_PORT (default 3000; "none" on a PaaS = SKIP) does not accept TCP
#                   connections on any address the URL's host resolves to (resolved now, never hardcoded).
#                   Control: the URL's own port must answer on each address. An address where the control does
#                   not answer cannot be checked, and then the check is ERROR, never PASS.
#
# FAIL = the check ran and the deploy breaks AC-39. ERROR = the check could not decide (no answer, rate limit).
# Exit 0 only when no check FAILs or ERRORs; 1 otherwise; 2 on bad usage.
# Env: ORIGIN_PORT (default 3000 | none), SMOKE_TIMEOUT (s per request, default 15),
#      SMOKE_CONNECT_TIMEOUT (s per TCP probe, default 5).
# It never prints an IP address it resolved or was told about, and it redacts addresses in the response bodies it
# quotes: the repo and the deploy logs are public.
set -uo pipefail

SPOOF_IP="198.51.100.23" # TEST-NET-2 (RFC 5737): never a real client
T="${SMOKE_TIMEOUT:-15}"
CT="${SMOKE_CONNECT_TIMEOUT:-5}"
ORIGIN_PORT="${ORIGIN_PORT:-3000}"

usage() { echo "usage: smoke-remote.sh <http(s)://host[:port][/base]> [--expect-version <sha>]" >&2; exit 2; }
# --expect-version <sha> (PR-04): also check that /api/health reports "version" == the sha's first 12 hex chars.
EXPECT="" URL=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expect-version) [ "$#" -ge 2 ] || usage; EXPECT=$2; shift 2 ;;
    -*) usage ;;
    *) [ -z "$URL" ] || usage; URL=$1; shift ;;
  esac
done
[ -n "$URL" ] || usage
if [ -n "$EXPECT" ]; then
  EXPECT=$(printf '%s' "$EXPECT" | tr 'A-F' 'a-f')
  printf '%s' "$EXPECT" | grep -Eqx '[0-9a-f]{12,40}' || { echo "smoke-remote: --expect-version needs a commit sha (12-40 hex chars)" >&2; exit 2; }
  EXPECT=${EXPECT:0:12}
fi
URL="${URL%/}"
case "$URL" in http://?* | https://?*) ;; *) usage ;; esac

SCHEME="${URL%%://*}"
REST="${URL#*://}"
HOSTPORT="${REST%%/*}"
case "$HOSTPORT" in *@*) echo "smoke-remote: credentials in the URL are not supported" >&2; exit 2 ;; esac
if [ "${HOSTPORT#\[}" != "$HOSTPORT" ]; then # [v6]:port
  HOST="${HOSTPORT#\[}"; HOST="${HOST%%]*}"
  PORT_PART="${HOSTPORT##*]}"; URL_PORT="${PORT_PART#:}"
else
  HOST="${HOSTPORT%%:*}"
  URL_PORT=""; [ "$HOST" != "$HOSTPORT" ] && URL_PORT="${HOSTPORT#*:}"
fi
[ -n "$URL_PORT" ] || { [ "$SCHEME" = https ] && URL_PORT=443 || URL_PORT=80; }
[ -n "$HOST" ] || usage

TMP="$(mktemp -d "${TMPDIR:-/tmp}/smoke-remote.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT TERM
N_PASS=0 N_FAIL=0 N_ERROR=0 N_SKIP=0

line() { printf '%-5s %s: %s\n' "$1" "$2" "$3"; }
pass()  { line PASS "$1" "$2"; N_PASS=$((N_PASS + 1)); }
fail()  { line FAIL "$1" "$2"; N_FAIL=$((N_FAIL + 1)); }
error() { line ERROR "$1" "$2"; N_ERROR=$((N_ERROR + 1)); }
skip()  { line SKIP "$1" "$2"; N_SKIP=$((N_SKIP + 1)); }

# curl exit code -> reason. curl's own message is not printed: it can carry an address.
curl_reason() {
  case "$1" in
    6) echo "could not resolve $HOST" ;;
    7) echo "could not connect to $HOST:$URL_PORT" ;;
    28) echo "timed out after ${T}s" ;;
    35) echo "TLS handshake failed" ;;
    51 | 60) echo "TLS certificate not valid for $HOST" ;;
    52) echo "empty reply" ;;
    *) echo "curl exit $1" ;;
  esac
}

# req <name> <curl args…>: body -> $TMP/<name>.body, headers -> $TMP/<name>.hdr, prints the HTTP status
req() {
  local name="$1"; shift
  curl -sS --max-time "$T" -o "$TMP/$name.body" -D "$TMP/$name.hdr" -w '%{http_code}' "$@" 2>"$TMP/$name.err"
}

# The start of a response body, for a FAIL or ERROR reason. A proxy, CDN or app error page can carry the
# caller's address, so anything that looks like an IPv4 or IPv6 address is replaced by <ip> first.
snippet() {
  tr -d '\r\n' <"$1" \
    | sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<ip>/g; s/[0-9A-Fa-f]{0,4}(:[0-9A-Fa-f]{0,4}){2,7}/<ip>/g' \
    | cut -c1-120
}

if ! command -v curl >/dev/null 2>&1; then
  error setup "curl is not installed"
  echo "smoke-remote: FAIL (0 PASS, 0 FAIL, 1 ERROR)"; exit 1
fi
echo "smoke-remote: $SCHEME://$HOSTPORT (AC-39)"

# ---- health ------------------------------------------------------------------------------------------
code=$(req health "$URL/api/health"); rc=$?
if [ "$rc" -ne 0 ]; then
  error health "GET /api/health: $(curl_reason "$rc")"
elif [ "$code" = 200 ] && grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$TMP/health.body"; then
  pass health "GET /api/health -> 200, ok:true"
else
  fail health "GET /api/health -> $code $(snippet "$TMP/health.body")"
fi
if [ -n "$EXPECT" ]; then
  got=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([0-9a-fA-F]*)".*/\1/p' "$TMP/health.body" 2>/dev/null | head -n 1)
  if [ "$rc" -ne 0 ]; then
    error version "no /api/health response to read the version from"
  elif [ "$got" = "$EXPECT" ]; then
    pass version "/api/health reports version $EXPECT"
  else
    fail version "/api/health reports version '${got:-none}', expected $EXPECT"
  fi
fi

# ---- hsts --------------------------------------------------------------------------------------------
if [ "$rc" -ne 0 ]; then
  error hsts "no response from /api/health to read headers from"
else
  hsts=$(grep -i '^strict-transport-security:' "$TMP/health.hdr" | tail -n 1 | tr -d '\r')
  age=$(printf '%s' "$hsts" | grep -oiE 'max-age="?[0-9]+' | grep -oE '[0-9]+$' || true)
  if [ "$SCHEME" != https ]; then
    if [ -n "$hsts" ]; then
      fail hsts "the URL is plain http: browsers ignore HSTS sent over http (header present: max-age=${age:-?})"
    else
      fail hsts "the URL is plain http and no Strict-Transport-Security header was sent"
    fi
  elif [ -z "$hsts" ]; then
    fail hsts "no Strict-Transport-Security header on /api/health"
  elif [ -z "$age" ] || [ "$age" -le 0 ]; then
    fail hsts "Strict-Transport-Security has no positive max-age: ${hsts#*:}"
  else
    pass hsts "https, Strict-Transport-Security max-age=$age"
  fi
fi

# ---- test routes -------------------------------------------------------------------------------------
bad="" n=0 n_err=0 first_err=""
for a in reset login clock qr tamper smoke-unknown; do
  for m in GET POST; do
    n=$((n + 1))
    if [ "$m" = GET ]; then
      c=$(req t "$URL/api/test/$a"); r=$?
    else
      c=$(req t -X POST -H 'content-type: application/json' --data '{"smoke-remote":1}' "$URL/api/test/$a"); r=$?
    fi
    if [ "$r" -ne 0 ]; then
      n_err=$((n_err + 1)); [ -n "$first_err" ] || first_err="$m /api/test/$a: $(curl_reason "$r")"
    elif [ "$c" != 404 ]; then bad="$bad $m /api/test/$a -> $c;"
    fi
  done
done
if [ -n "$bad" ]; then fail test-routes "not 404:${bad%;}"
elif [ "$n_err" -gt 0 ]; then error test-routes "no answer on $n_err of $n requests (first: $first_err)"
else pass test-routes "$n requests to /api/test/* -> 404"
fi

# ---- providers ---------------------------------------------------------------------------------------
code=$(req providers "$URL/api/auth/providers"); rc=$?
if [ "$rc" -ne 0 ]; then
  error providers "GET /api/auth/providers: $(curl_reason "$rc")"
elif grep -q 'test-login' "$TMP/providers.body"; then
  fail providers "a test-login provider is listed (HTTP $code)"
elif [ "$code" != 200 ] || [ "$(head -c 1 "$TMP/providers.body")" != "{" ]; then
  error providers "cannot judge: GET /api/auth/providers -> $code $(snippet "$TMP/providers.body")"
else
  ids=$(grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMP/providers.body" | sed -E 's/.*"([^"]*)"$/\1/' | sort -u | tr '\n' ' ')
  pass providers "no test-login provider (providers: ${ids% })"
fi

# ---- client ip: a plain request first, then spoofed headers ------------------------------------------
# The spoof checks mean something only if the app sees a client address at all. If TRUSTED_IP_HEADER names a
# header the proxy never sends, or TRUSTED_PROXY_HOPS is too high, every request gets ip: null: no spoof can come
# back, and every scan fails with ip_unknown. So ip: null is ERROR, never PASS. The address itself is not printed.
IP_NULL='"ip"[[:space:]]*:[[:space:]]*null'
code=$(req clientip "$URL/api/client-ip"); rc=$?
if [ "$rc" -ne 0 ]; then
  error client-ip "GET /api/client-ip: $(curl_reason "$rc")"
elif [ "$code" = 429 ]; then
  error client-ip "rate limited (429): try again in a minute"
elif [ "$code" != 200 ] || ! grep -q '"ip"' "$TMP/clientip.body"; then
  error client-ip "cannot judge: GET /api/client-ip -> $code $(snippet "$TMP/clientip.body")"
elif grep -Eq "$IP_NULL" "$TMP/clientip.body"; then
  error client-ip "the app sees no client IP on a plain request (ip: null): check TRUSTED_IP_HEADER / TRUSTED_PROXY_HOPS"
else
  pass client-ip "the app sees a client address on a plain request (not printed)"
fi

spoof() { # spoof <label> <header args…>
  local label="$1"; shift
  local c r
  c=$(req spoof "$@" "$URL/api/client-ip"); r=$?
  if [ "$r" -ne 0 ]; then error "spoof $label" "GET /api/client-ip: $(curl_reason "$r")"; return; fi
  if grep -qF "$SPOOF_IP" "$TMP/spoof.body"; then
    fail "spoof $label" "/api/client-ip returned the spoofed $SPOOF_IP: the header reaches the app unchanged"
  elif [ "$c" = 429 ]; then
    error "spoof $label" "rate limited (429): try again in a minute"
  elif [ "$c" != 200 ] || ! grep -q '"ip"' "$TMP/spoof.body"; then
    error "spoof $label" "cannot judge: GET /api/client-ip -> $c $(snippet "$TMP/spoof.body")"
  elif grep -Eq "$IP_NULL" "$TMP/spoof.body"; then
    error "spoof $label" "cannot judge: ip: null, so the app sees no client IP at all"
  else
    pass "spoof $label" "ignored (the app saw another address)"
  fi
}
# x-test-client-ip is the test-mode override (spec TH-05, TH-14). AC-36 checks it on a local prod build; here it
# is checked on the live deploy too.
for h in X-Forwarded-For X-Real-IP CF-Connecting-IP Fly-Client-IP x-test-client-ip; do
  spoof "$h" -H "$h: $SPOOF_IP"
done
spoof "all at once" -H "X-Forwarded-For: $SPOOF_IP" -H "X-Real-IP: $SPOOF_IP" \
  -H "CF-Connecting-IP: $SPOOF_IP" -H "Fly-Client-IP: $SPOOF_IP" -H "x-test-client-ip: $SPOOF_IP"

# ---- origin port -------------------------------------------------------------------------------------
is_ip() { printf '%s' "$1" | grep -Eq '^[0-9]+(\.[0-9]+){3}$|^[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*$'; }
resolve() {
  if is_ip "$1"; then printf '%s\n' "$1"; return 0; fi
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$1" | awk '{ print $1 }' | sort -u
  elif command -v dig >/dev/null 2>&1; then
    { dig +short A "$1"; dig +short AAAA "$1"; } | grep -E '^[0-9]+(\.[0-9]+){3}$|:' | sort -u
  else
    return 1
  fi
}
# shellcheck disable=SC2016 # $1/$2 expand in the inner bash, on purpose
tcp_open() { timeout "$CT" bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$1" "$2" 2>/dev/null; }

if [ "$ORIGIN_PORT" = none ]; then
  skip origin-port "ORIGIN_PORT=none (a PaaS has no origin port to probe)"
elif ! printf '%s' "$ORIGIN_PORT" | grep -Eq '^[1-9][0-9]{0,4}$' || [ "$ORIGIN_PORT" -gt 65535 ]; then
  error origin-port "ORIGIN_PORT must be a port number or none, got '$ORIGIN_PORT'"
elif ! command -v timeout >/dev/null 2>&1; then
  error origin-port "needs the timeout command (coreutils)"
else
  addrs=$(resolve "$HOST" 2>/dev/null || true)
  total=$(printf '%s' "$addrs" | grep -c . || true)
  if [ "$total" -eq 0 ]; then
    error origin-port "could not resolve $HOST (getent or dig needed)"
  else
    open=0 closed=0 unsure=0
    while IFS= read -r ip; do
      [ -n "$ip" ] || continue
      if ! tcp_open "$ip" "$URL_PORT"; then unsure=$((unsure + 1)); continue; fi # control failed
      if tcp_open "$ip" "$ORIGIN_PORT"; then open=$((open + 1)); else closed=$((closed + 1)); fi
    done <<<"$addrs"
    # FAIL first; an address that could not be checked is ERROR, never PASS. PASS only when every address was
    # checked and the app port is closed on all of them.
    if [ "$open" -gt 0 ]; then
      note=""; [ "$unsure" -gt 0 ] && note=" ($unsure more could not be checked: port $URL_PORT did not answer there)"
      fail origin-port "port $ORIGIN_PORT accepts TCP connections on $open of $total address(es) of $HOST: the app is reachable without the proxy$note"
    elif [ "$unsure" -gt 0 ]; then
      error origin-port "cannot judge $unsure of $total address(es) of $HOST: port $URL_PORT (control) did not answer there"
    else
      pass origin-port "port $ORIGIN_PORT closed on all $total address(es) of $HOST, port $URL_PORT open there"
    fi
  fi
fi

# ---- verdict -----------------------------------------------------------------------------------------
summary="$N_PASS PASS, $N_FAIL FAIL, $N_ERROR ERROR, $N_SKIP SKIP"
if [ "$N_FAIL" -eq 0 ] && [ "$N_ERROR" -eq 0 ]; then
  echo "smoke-remote: PASS ($summary)"; exit 0
fi
echo "smoke-remote: FAIL ($summary)"; exit 1
