#!/usr/bin/env bash
# Runs a test command; on failure, repeats its failed checks and errors as
# GitHub Actions annotations (readable without access to the job log).
#
# Usage: tools/ci-report.sh <command> [args...]
set -uo pipefail

log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [[ $status -ne 0 ]]; then
    grep -E "FAIL|JS ERROR|JS WARNING|CRITICAL|ERROR \*\*|did not start" "$log" |
        head -n 10 | sed 's/^/::error::/'
fi
rm -f "$log"
exit "$status"
