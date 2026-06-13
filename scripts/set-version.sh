#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

if [[ "$VERSION" == v* ]]; then
  echo "Error: version must not start with v; use ${VERSION#v}" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  echo "Error: version must be a SemVer release like 1.2.3, 1.2.3-rc.1, or 1.2.3-beta.1" >&2
  exit 1
fi

tmp=$(mktemp)
jq --arg v "$VERSION" '.version = $v' "$ROOT_DIR/package.json" > "$tmp"
mv "$tmp" "$ROOT_DIR/package.json"

"$ROOT_DIR/scripts/sync-versions.sh"
"$ROOT_DIR/scripts/check-versions.sh" "$VERSION"
