#!/usr/bin/env bash
# Smoke tests against a live SillyTavern instance
# Usage: ./tests/smoke.sh [port]
# Requires: curl, ST running with StoryArc extension

set -euo pipefail

PORT="${1:-8008}"
BASE="http://localhost:$PORT"
PASS=0
FAIL=0

check() {
    local desc="$1" url="$2" expect="$3"
    local body status
    body=$(curl -sf "$url" 2>/dev/null) && status=0 || status=1

    if [ $status -eq 0 ] && echo "$body" | grep -q "$expect"; then
        echo "  PASS: $desc"
        PASS=$((PASS+1))
    else
        echo "  FAIL: $desc (expected '$expect' in response)"
        FAIL=$((FAIL+1))
    fi
}

echo "StoryArc smoke tests against $BASE"
echo "---"

# Extension discovery
check "Extension discovered" \
    "$BASE/api/extensions/discover" \
    "StoryArc"

# Manifest served
check "manifest.json served" \
    "$BASE/scripts/extensions/third-party/StoryArc/manifest.json" \
    "Story Arc"

# Entry point served
check "index.js served" \
    "$BASE/scripts/extensions/third-party/StoryArc/index.js" \
    "Story Arc"

# CSS served
check "style.css served" \
    "$BASE/scripts/extensions/third-party/StoryArc/style.css" \
    "core.css"

# Core module served
check "core/constants.js served" \
    "$BASE/scripts/extensions/third-party/StoryArc/lib/core/constants.js" \
    "MODULE_NAME"

# Prompt templates served
check "analyze-context.txt served" \
    "$BASE/scripts/extensions/third-party/StoryArc/prompts/analyze-context.txt" \
    "CHARACTER_DESCRIPTION"

check "generate-arc.txt served" \
    "$BASE/scripts/extensions/third-party/StoryArc/prompts/generate-arc.txt" \
    "PHASE1_ANALYSIS"

echo "---"
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1
