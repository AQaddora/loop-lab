#!/usr/bin/env bash
# loop-lab secret store. Values live OUTSIDE the repo (owner-only) and are never printed.
#   loop/secrets.sh add <app>     read KEY=VALUE lines from stdin, merge into the store (later keys win)
#   loop/secrets.sh names <app>   show key names with masked values
#   loop/secrets.sh link <app>    symlink the store file to apps/<app>/.env.local (gitignored)
#   loop/secrets.sh verify <app>  live-check the creds (meet: LiveKit ListRooms, attendance: Google OAuth client)
# Zero-transcript handoff from the Mac:  pbpaste | ssh <you>@loop-runner '~/loop-lab/loop/secrets.sh add attendance'
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="${LOOP_SECRETS_DIR:-$HOME/.config/loop-lab/secrets}"
cmd="${1:-}"; app="${2:-}"
usage() { echo "usage: loop/secrets.sh add|names|link|verify <app>" >&2; exit 1; }
[[ -n "$cmd" && "$app" =~ ^[a-z0-9-]+$ ]] || usage
file="$STORE/$app.env"
case "$cmd" in
  add)
    umask 077; mkdir -p "$STORE"; chmod 700 "$STORE"
    tmp="$(mktemp "$STORE/.$app.XXXXXX")"
    { [[ -f "$file" ]] && cat "$file"; tr -d '\r' | sed -E 's/^export +//' | grep -E '^[A-Za-z_][A-Za-z0-9_]*='; } > "$tmp.in" || true
    awk -F= '!/^#/ && NF { k=$1; v[k]=$0; if (!(k in seen)) { order[++n]=k; seen[k]=1 } } END { for (i=1;i<=n;i++) print v[order[i]] }' "$tmp.in" > "$tmp"
    rm -f "$tmp.in"; mv "$tmp" "$file"; chmod 600 "$file"
    "$0" names "$app" ;;
  names)
    [[ -f "$file" ]] || { echo "no secrets stored for $app" >&2; exit 1; }
    awk -F= '/^[A-Za-z_]/ { v=substr($0, length($1)+2); printf "%s=%s (masked, %d chars)\n", $1, (length(v) > 12 ? substr(v,1,4) "…" : "…"), length(v) }' "$file" ;;
  link)
    [[ -f "$file" ]] || { echo "no secrets stored for $app" >&2; exit 1; }
    [[ -d "$ROOT/apps/$app" ]] || { echo "apps/$app not scaffolded yet" >&2; exit 1; }
    ln -sfn "$file" "$ROOT/apps/$app/.env.local"; echo "linked apps/$app/.env.local -> $file" ;;
  verify)
    [[ -f "$file" ]] || { echo "no secrets stored for $app" >&2; exit 1; }
    case "$app" in
      meet)       node "$ROOT/loop/checks/livekit-check.mjs" "$file" ;;
      attendance) node "$ROOT/loop/checks/google-oauth-check.mjs" "$file" ;;
      *)          "$0" names "$app" ;;
    esac ;;
  *) usage ;;
esac
