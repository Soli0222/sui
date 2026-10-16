#!/usr/bin/env bash
set -euo pipefail

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
  || { echo 'Use an existing SemVer release without a v prefix.' >&2; exit 1; }

release=$(gh release view "$VERSION" --repo "$GITHUB_REPOSITORY" --json tagName,isDraft)
jq -e --arg version "$VERSION" '.tagName == $version and .isDraft == false' <<< "$release" >/dev/null
sha=$(git rev-parse --verify "refs/tags/${VERSION}^{commit}")
echo "sha=$sha" >> "$GITHUB_OUTPUT"
