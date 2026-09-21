#!/usr/bin/env bash
# The verification gate. Exits non-zero if anything fails.
#
# This exists because "chain it with &&" is a convention, and a convention is
# something you can hold wrong. It was held wrong the commit after it was
# written down: `pnpm verify | grep -E 'Tests |error' && git commit` passed,
# because a pipeline's exit status is the LAST command's and grep succeeded by
# finding the word "error" in the lint output. A commit went out over a red
# verify.
#
# What this fixes, precisely: the gate is now one command with one exit status,
# so `pnpm verify && git commit` is safe and no step's failure can be hidden
# inside a chain.
#
# What it does NOT fix, because nothing can: piping it through a filter still
# discards its status, since a pipeline reports the LAST command's. Measured,
# not assumed —
#
#   bash scripts/verify.sh > /dev/null 2>&1           -> exit 1 on a broken repo
#   bash scripts/verify.sh | grep -E 'Tests |error'   -> exit 0, still
#
# So: run it, do not pipe it. If output needs filtering, redirect to a file and
# read the file. CI is the backstop either way.
#
#   bash scripts/verify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Run each step and report which failed, rather than leaving someone to find
# it in the scrollback.
step() {
  local name="$1"
  shift
  if ! "$@"; then
    echo ""
    echo "FAILED: ${name}"
    exit 1
  fi
}

BIN="$ROOT/node_modules/.bin"

step "lint"      "$BIN/eslint" .
step "typecheck" "$BIN/tsc" --noEmit
step "typecheck (widget)" "$BIN/tsc" --noEmit -p apps/widget
step "format"    "$BIN/prettier" --check .
step "test"      "$BIN/vitest" run

echo ""
echo "verify: all steps passed"
