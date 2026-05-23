#!/usr/bin/env bash
# Run all StoryArc tests
# Usage: ./tests/run.sh [optional test file pattern]

cd "$(dirname "$0")/.." || exit 1

PATTERN="${1:-tests/test-*.js}"
node --import ./tests/setup.js --test $PATTERN
