"""Verify that the documentation gate fails on drift and broken navigation."""
from pathlib import Path
import tempfile
import unittest

from check_docs import check_inventories, check_links, compare_inventory
from validate_okf import validate


class DocumentationChecks(unittest.TestCase):
    def test_okf_rejects_missing_type_and_invalid_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.md').write_text('---\nokf_version: "0.2"\n---\n# Bundle\n')
            (root / 'rule.md').write_text('---\ntitle: Rule\ngenerated: {by: unknown, at: yesterday}\n---\n# Rule\n')
            findings = validate(root)
            self.assertTrue(any(f.level == 'ERROR' and "'type'" in f.message for f in findings))
            self.assertTrue(any('generated.by' in f.message for f in findings))
            self.assertTrue(any('generated.at' in f.message for f in findings))

    def test_links_cover_images_anchors_and_bundle_root_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docs = root / 'docs'
            docs.mkdir()
            (docs / 'target.md').write_text('# 共通 時計\n# 共通 時計\n')
            source = docs / 'source.md'
            source.write_text('[first](/target.md#共通-時計)\n[second](target.md#共通-時計-1)\n'
                              '[bad](target.md#missing)\n![image](missing.png)\n'
                              '[ref]: absent.md\n```md\n[example](not-real.md)\n```\n')
            findings = check_links(root, source)
            self.assertEqual(len(findings), 3)
            self.assertTrue(any('missing heading' in f for f in findings))
            self.assertTrue(any('missing.png' in f for f in findings))
            self.assertTrue(any('absent.md' in f for f in findings))

    def test_inventory_detects_missing_obsolete_and_duplicate_entries(self):
        findings = compare_inventory('tools', {'current', 'added'}, ['current', 'current', 'retired'])
        self.assertEqual(len(findings), 3)
        self.assertTrue(any('undocumented: added' in f for f in findings))
        self.assertTrue(any('obsolete: retired' in f for f in findings))
        self.assertTrue(any('duplicate: current' in f for f in findings))

    def test_api_methods_and_query_parameters_match_the_contract_map(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'packages/backend/src/mcp'
            refs = root / 'docs/references'
            source.mkdir(parents=True)
            refs.mkdir(parents=True)
            (source / 'api-parity.ts').write_text('export const apiParity = {\n'
                '  "GET /api/items": ["list_items"],\n'
                '  "POST /api/items": ["create_item"],\n'
                '  "GET /api/auth/status": { browserSession: "UI" },\n};\n')
            (refs / 'api-endpoints.md').write_text('| GET / POST | `/api/items?year=YYYY` | items |\n'
                                                   '| GET | `/api/auth/status` | status |\n')
            inventory = refs / 'mcp-tools.md'
            inventory.write_text('| `list_items` | list |\n| `create_item` | create |\n')
            self.assertEqual(check_inventories(root), [])
            inventory.write_text('| `list_items` | list |\n')
            self.assertEqual(check_inventories(root), ['MCP reference: undocumented: create_item'])


if __name__ == '__main__':
    unittest.main()
