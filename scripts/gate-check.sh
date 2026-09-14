#!/usr/bin/env bash
# Reports CI status for the exact commit at HEAD, and refuses a gate if it is
# not green.
#
# A red pipeline stayed red for three days because nothing carried that fact to
# anyone. Two pushes failed `prettier --check` and the only record was a page
# nobody had a reason to open. The absence of a signal is not a signal, so this
# produces one, and it produces it at the moment a phase is being closed —
# which is the moment someone is actually reading.
#
# Three things are deliberately NOT green:
#   - no run for this commit   (unpushed, or the workflow never triggered)
#   - a run still in progress  (unknown is not success)
#   - a run on a different sha (the branch tip is not the commit under review)
#
# The third is the one that matters most. `gh run list` without a sha filter
# answers "how did the last push go", which is a different question from "is
# the thing I am about to sign off green".
#
#   pnpm gate            check, print the gate-report line, exit non-zero if red
#   pnpm gate --report   print only the line, always exit 0
set -uo pipefail

REPORT_ONLY=false
[ "${1:-}" = "--report" ] && REPORT_ONLY=true

SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"

fail() {
  echo "CI at HEAD ($SHORT): $1"
  $REPORT_ONLY && exit 0
  exit 1
}

if ! command -v gh >/dev/null 2>&1; then
  fail "UNKNOWN — gh is not installed, so CI status could not be read"
fi

DIRTY=""
[ -n "$(git status --porcelain)" ] && DIRTY=" (working tree dirty — CI has not seen these changes)"

# --json emits [] rather than failing when the sha is unknown to GitHub.
RUNS="$(gh run list --commit "$SHA" --json status,conclusion,workflowName,url 2>/dev/null)"
if [ -z "$RUNS" ] || [ "$RUNS" = "[]" ]; then
  fail "NO RUN — this commit has not been pushed, or no workflow triggered on it$DIRTY"
fi

PENDING="$(echo "$RUNS" | jq -r '[.[] | select(.status != "completed")] | length')"
FAILED="$(echo "$RUNS" | jq -r '[.[] | select(.conclusion != "success" and .status == "completed")] | length')"
TOTAL="$(echo "$RUNS" | jq -r 'length')"

if [ "$PENDING" != "0" ]; then
  fail "IN PROGRESS — $PENDING of $TOTAL run(s) still going. Unknown is not green$DIRTY"
fi

if [ "$FAILED" != "0" ]; then
  echo "CI at HEAD ($SHORT): RED — $FAILED of $TOTAL run(s) failed$DIRTY"
  echo "$RUNS" | jq -r '.[] | select(.conclusion != "success") | "  \(.workflowName): \(.conclusion)  \(.url)"'
  $REPORT_ONLY && exit 0
  echo
  echo "A phase does not close over a red pipeline. Fix it, push, and re-run."
  exit 1
fi

echo "CI at HEAD ($SHORT): green — $TOTAL/$TOTAL run(s) passed$DIRTY"
[ -n "$DIRTY" ] && ! $REPORT_ONLY && exit 1
exit 0
