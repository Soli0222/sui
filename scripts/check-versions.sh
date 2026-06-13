#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VERSION="${1:-}"
ROOT_VERSION=$(jq -r '.version' "$ROOT_DIR/package.json")

if [ -z "$ROOT_VERSION" ] || [ "$ROOT_VERSION" = "null" ]; then
  echo "Error: version not found in root package.json" >&2
  exit 1
fi

if [ -n "$EXPECTED_VERSION" ] && [ "$EXPECTED_VERSION" != "$ROOT_VERSION" ]; then
  echo "Error: root package.json version ${ROOT_VERSION} does not match expected ${EXPECTED_VERSION}" >&2
  exit 1
fi

failed=0
for pkg in "$ROOT_DIR"/packages/*/package.json; do
  name=$(jq -r '.name' "$pkg")
  version=$(jq -r '.version' "$pkg")

  if [ "$version" != "$ROOT_VERSION" ]; then
    echo "Error: ${name} has version ${version}, expected ${ROOT_VERSION}" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "All package versions are synced at ${ROOT_VERSION}"
