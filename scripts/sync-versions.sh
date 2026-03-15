#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(jq -r '.version' "$ROOT_DIR/package.json")

if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "Error: version not found in root package.json" >&2
  exit 1
fi

echo "Syncing all packages to version ${VERSION}"

for pkg in "$ROOT_DIR"/packages/*/package.json; do
  name=$(jq -r '.name' "$pkg")
  old=$(jq -r '.version' "$pkg")
  if [ "$old" != "$VERSION" ]; then
    jq --arg v "$VERSION" '.version = $v' "$pkg" > "$pkg.tmp" && mv "$pkg.tmp" "$pkg"
    echo "  ${name}: ${old} -> ${VERSION}"
  else
    echo "  ${name}: already ${VERSION}"
  fi
done

echo "Done"
