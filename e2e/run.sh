#!/usr/bin/env bash
# Runs the end-to-end tests against a throwaway compose stack (see DEVELOPMENT.md,
# "End-to-end tests"): build or take an image, bring the stack up, run Playwright
# in the official Playwright container, take everything down again.
#
#   e2e/run.sh                      builds the image from this checkout (wickermoney:e2e)
#   E2E_IMAGE=ghcr.io/wickermoney/wicker-money:edge e2e/run.sh
#                                   tests a published image instead, no build
#   e2e/run.sh -- tests/smoke.spec.ts   extra arguments after -- go to `playwright test`
#
# Needs Docker with the compose plugin. The report is written to e2e/reports/
# (html/index.html, junit.xml, traces for failures). Exit status is Playwright's.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root/docker/docker-compose.e2e.yml"

args=()
if [ "${1:-}" = "--" ]; then shift; args=("$@"); fi

if [ -z "${E2E_IMAGE:-}" ]; then
  export E2E_IMAGE="wickermoney:e2e"
  echo "Building $E2E_IMAGE from $root"
  docker build -f "$root/docker/Dockerfile" -t "$E2E_IMAGE" "$root" || exit 1
else
  echo "Testing the image $E2E_IMAGE"
fi

# The Playwright container image must be the version e2e/package.json pins.
E2E_PLAYWRIGHT_VERSION="$(sed -n 's/.*"@playwright\/test": *"\([0-9.]*\)".*/\1/p' "$root/e2e/package.json")"
if [ -z "$E2E_PLAYWRIGHT_VERSION" ]; then
  echo "Could not read the pinned @playwright/test version from e2e/package.json" >&2
  exit 1
fi
export E2E_PLAYWRIGHT_VERSION
export E2E_ARGS="${args[*]:-}"

mkdir -p "$root/e2e/reports"
compose=(docker compose -f "$compose_file" --profile test)

# Always leave nothing behind, whatever the outcome.
trap '"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1' EXIT

"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1
if ! "${compose[@]}" up --wait --detach wickermoney; then
  echo "The stack did not become healthy. Logs:" >&2
  "${compose[@]}" logs --no-color >&2
  exit 1
fi

"${compose[@]}" run --rm playwright
status=$?

if [ "$status" -ne 0 ]; then
  echo "Playwright failed (exit $status). App log tail:" >&2
  "${compose[@]}" logs --no-color --tail 40 wickermoney >&2
  echo "Report: $root/e2e/reports/html/index.html (open traces with: npx playwright show-trace <trace.zip>)" >&2
fi
exit "$status"
