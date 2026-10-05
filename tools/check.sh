#!/usr/bin/env bash
# Runs the unit tests and the headless GNOME Shell scenarios; exits non-zero
# if anything fails. Logs are kept in $NETPULSE_TEST_OUTPUT (./test-output).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${NETPULSE_TEST_OUTPUT:-$ROOT/test-output}"
mkdir -p "$OUTPUT"

status=0

echo "== Unit tests"
if gjs -m "$ROOT/tests/run.js" >"$OUTPUT/unit.log" 2>&1; then
    tail -n 1 "$OUTPUT/unit.log"
else
    grep -E "FAIL|passed" "$OUTPUT/unit.log"
    status=1
fi

echo "== Installer"
if "$ROOT/tests/install/test-install.sh" >"$OUTPUT/install.log" 2>&1; then
    echo "all checks passed"
else
    grep -E "FAIL" "$OUTPUT/install.log"
    status=1
fi

echo "== Headless GNOME Shell scenarios"
if "$ROOT/tools/test-headless.sh" >"$OUTPUT/shell.log" 2>&1; then
    echo "all scenarios passed"
else
    grep -E "FAIL|JS ERROR|CRITICAL|ERROR \*\*|FAILED" "$OUTPUT/shell.log"
    status=1
fi

echo "== Network switching scenarios (private network namespace)"
if NETPULSE_NETNS=1 NETPULSE_TEST_OUTPUT="$OUTPUT/netns" "$ROOT/tools/test-headless.sh" \
    >"$OUTPUT/netns.log" 2>&1; then
    echo "all scenarios passed"
else
    grep -E "FAIL|JS ERROR|CRITICAL|ERROR \*\*|FAILED" "$OUTPUT/netns.log"
    status=1
fi

exit "$status"
