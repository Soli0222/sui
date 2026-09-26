"""Project checks layered on the vendored OKF validator; no network or DB."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

from validate_okf import require_yaml, strip_code_blocks, validate

ROOT = Path(__file__).resolve().parents[2]
# Inline links and images used by the repository. Reference definitions are
# handled separately. Fenced code is excluded before either scan.
LINK = re.compile(r'!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)')
REFERENCE = re.compile(r'^\s*\[(?!\^)[^\]]+\]:\s*(\S+)', re.M)
API_ROW = re.compile(r'^\| ((?:GET|POST|PUT|PATCH|DELETE)(?: / (?:GET|POST|PUT|PATCH|DELETE))*) \| `([^`]+)`', re.M)
MAP_ROW = re.compile(r'^  "((?:GET|POST|PUT|PATCH|DELETE) /api/[^\"]+)": (.+),$', re.M)
TOOL_ROW = re.compile(r'^\| `([a-z_]+)` \|', re.M)


def anchors(text: str) -> set[str]:
    result: set[str] = set()
    counts: Counter[str] = Counter()
    for title in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', strip_code_blocks(text), re.M):
        title = re.sub(r'!?\[([^\]]+)\]\([^)]*\)', r'\1', title)
        slug = re.sub(r'[^\w\-\s]', '', title.lower()).replace(' ', '-')
        occurrence = counts[slug]
        counts[slug] += 1
        result.add(f'{slug}-{occurrence}' if occurrence else slug)
    result.update(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)', text))
    return result


def check_links(root: Path, path: Path) -> list[str]:
    prose = strip_code_blocks(path.read_text())
    errors = []
    for target in LINK.findall(prose) + REFERENCE.findall(prose):
        parsed = urlsplit(target.strip('<>'))
        if parsed.scheme or parsed.netloc:
            continue
        relative = unquote(parsed.path)
        if relative.startswith('/'):
            base = root / 'docs' if path.is_relative_to(root / 'docs') else root
            resolved = base / relative.lstrip('/')
        else:
            resolved = path.parent / relative if relative else path
        resolved = resolved.resolve()
        if not resolved.exists():
            errors.append(f'{path.relative_to(root)}: missing link/image: {target}')
            continue
        if resolved.is_dir():
            resolved = resolved / ('index.md' if resolved.is_relative_to(root / 'docs') else 'README.md')
            if not resolved.exists():
                errors.append(f'{path.relative_to(root)}: directory has no entry document: {target}')
                continue
        if parsed.fragment and resolved.suffix == '.md':
            if unquote(parsed.fragment) not in anchors(resolved.read_text()):
                errors.append(f'{path.relative_to(root)}: missing heading: {target}')
    return errors


def compare_inventory(label: str, expected: set[str], actual: list[str]) -> list[str]:
    errors = []
    found = set(actual)
    for value in sorted(expected - found):
        errors.append(f'{label}: undocumented: {value}')
    for value in sorted(found - expected):
        errors.append(f'{label}: obsolete: {value}')
    for value, count in Counter(actual).items():
        if count > 1:
            errors.append(f'{label}: duplicate: {value}')
    return errors


def check_inventories(root: Path) -> list[str]:
    rows = MAP_ROW.findall((root / 'packages/backend/src/mcp/api-parity.ts').read_text())
    if not rows:
        return ['api-parity.ts: no API entries found; update the documentation checker for the new format']
    expected_api = {route for route, _ in rows}
    expected_tools = {name for _, value in rows if value.startswith('[')
                      for name in re.findall(r'"([a-z_]+)"', value)}
    if not expected_tools:
        return ['api-parity.ts: no tool mappings found']
    api_doc = (root / 'docs/references/api-endpoints.md').read_text()
    actual_api = [f'{method} {path.split("?", 1)[0]}'
                  for methods, path in API_ROW.findall(api_doc) if path.startswith('/api/')
                  for method in methods.split(' / ')]
    tools_doc = (root / 'docs/references/mcp-tools.md').read_text()
    return (compare_inventory('API reference', expected_api, actual_api)
            + compare_inventory('MCP reference', expected_tools, TOOL_ROW.findall(tools_doc)))


def check(root: Path) -> list[str]:
    root = root.resolve()
    require_yaml()
    errors = [finding.render(root / 'docs') for finding in validate(root / 'docs')]
    files = [root / 'README.md', root / 'AGENTS.md', root / 'charts/sui/README.md']
    files.extend(sorted((root / 'docs').rglob('*.md')))
    for path in files:
        errors.extend(check_links(root, path))
    errors.extend(check_inventories(root))
    return errors


if __name__ == '__main__':
    findings = check(ROOT)
    for finding in findings:
        print(finding, file=sys.stderr)
    print(f'Documentation: {len(findings)} finding(s)')
    raise SystemExit(bool(findings))
