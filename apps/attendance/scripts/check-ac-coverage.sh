#!/usr/bin/env bash
# AC-40 coverage guard (spec §7.5). The oracle's own oracle: no AC can stay untested and no test can be switched off.
#
#   scripts/check-ac-coverage.sh [AC-NN …]
#
# With ids: checks those ids. Without: every AC in the spec's §8 table except AC-39 (verified by the deploy task).
# An AC is covered when a test( / it( / describe( title under the test dirs starts with its id
# (e.g. test('AC-13 wrong IP rejected', …)). A script AC (its §8 "Test" cell names `scripts/…`) is covered
# when that script exists and contains the id.
# Always fails on .skip( .only( .fixme( test.todo xit( xdescribe( test.fail( or passWithNoTests anywhere in the
# test dirs or the test configs.
#
# Paths resolve from this script's dir. Overrides (used by tests/unit/ac-coverage.test.ts):
#   SPEC=<spec.md>   TEST_DIRS="<dir> <dir>"   TEST_CONFIGS="<file> <file>"   APP_DIR=<dir for scripts/…>
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SELF_DIR/.." && pwd)}"
SPEC="${SPEC:-$APP_DIR/../../specs/attendance.md}"
TEST_DIRS="${TEST_DIRS:-$APP_DIR/tests $APP_DIR/e2e}"
TEST_CONFIGS="${TEST_CONFIGS:-$APP_DIR/vitest.config.ts $APP_DIR/playwright.config.ts}"
EXCLUDED_BY_DEFAULT="AC-39"

fail=0
say() { printf '%s\n' "$*"; }

[ -f "$SPEC" ] || { say "check-ac-coverage: spec not found: $SPEC"; exit 2; }

# ---- the §8 table: "AC-NN<TAB>test cell" -------------------------------------------------------------
table=$(awk '
  /^## 8\./ { in8 = 1; next }
  /^## / && in8 { in8 = 0 }
  in8 && /^\| AC-[0-9]+ \|/ {
    n = split($0, cell, "|")
    id = cell[2]; gsub(/^ +| +$/, "", id)
    t = cell[n - 1]; gsub(/^ +| +$/, "", t)
    print id "\t" t
  }' "$SPEC")
[ -n "$table" ] || { say "check-ac-coverage: no AC rows found in §8 of $SPEC"; exit 2; }

if [ "$#" -gt 0 ]; then
  wanted="$*"
else
  wanted=$(printf '%s\n' "$table" | cut -f1 | grep -vxF "$EXCLUDED_BY_DEFAULT" | tr '\n' ' ')
fi

# ---- the test corpus: every file flattened to one line, so a title on the next line still counts ----------
existing_dirs=()
for d in $TEST_DIRS; do [ -d "$d" ] && existing_dirs+=("$d"); done
corpus=$(mktemp)
trap 'rm -f "$corpus"' EXIT
if [ "${#existing_dirs[@]}" -gt 0 ]; then
  while IFS= read -r -d '' f; do
    tr '\n\r' '  ' <"$f" >>"$corpus"
    printf '\n' >>"$corpus"
  done < <(find "${existing_dirs[@]}" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' \) -print0)
fi

# ---- 1. forbidden markers ------------------------------------------------------------------------------
scan_files=()
for d in "${existing_dirs[@]}"; do scan_files+=("$d"); done
for c in $TEST_CONFIGS; do [ -f "$c" ] && scan_files+=("$c"); done
markers='\.(skip|only|fixme)[[:space:]]*\(|(^|[^[:alnum:]_$.])test\.todo([^[:alnum:]_$]|$)|(^|[^[:alnum:]_$.])(xit|xdescribe)[[:space:]]*\(|(^|[^[:alnum:]_$.])test\.fail[[:space:]]*\(|passWithNoTests'
if [ "${#scan_files[@]}" -gt 0 ]; then
  hits=$(grep -rEn "$markers" "${scan_files[@]}" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    say "FORBIDDEN test markers (skip/only/fixme/todo/xit/xdescribe/test.fail/passWithNoTests):"
    printf '%s\n' "$hits" | sed 's/^/  /'
    fail=1
  fi
fi

# ---- 2. every wanted AC has a titled test (or, for script ACs, a script that names it) --------------------
for id in $wanted; do
  if ! printf '%s\n' "$id" | grep -Eqx 'AC-[0-9]+'; then
    say "  BAD    $id (not an AC id)"; fail=1; continue
  fi
  cell=$(printf '%s\n' "$table" | awk -F'\t' -v id="$id" '$1 == id { print $2; exit }')
  if [ -z "$cell" ] && ! printf '%s\n' "$table" | cut -f1 | grep -qxF "$id"; then
    say "  MISSING $id is not in the §8 table of $(basename "$SPEC")"; fail=1; continue
  fi
  script=$(printf '%s' "$cell" | grep -oE '^`?scripts/[A-Za-z0-9._/-]+' | tr -d '`' || true)
  if [ -n "$script" ]; then
    if [ -f "$APP_DIR/$script" ] && grep -qE "(^|[^0-9A-Za-z-])${id}([^0-9]|$)" "$APP_DIR/$script"; then
      say "  ok     $id ($script)"
    else
      say "  MISSING $id: $script must exist and contain $id"; fail=1
    fi
    continue
  fi
  title_re="(^|[^[:alnum:]_\$])(test|it|describe)(\\.(describe|serial|parallel|step))?[[:space:]]*\\([[:space:]]*[\"'\`]${id}([^0-9]|\$)"
  if grep -Eq "$title_re" "$corpus"; then
    say "  ok     $id"
  else
    say "  MISSING $id: no test titled \"$id …\""; fail=1
  fi
done

if [ "$fail" -eq 0 ]; then say "check-ac-coverage: PASS"; exit 0; fi
say "check-ac-coverage: FAIL"
exit 1
