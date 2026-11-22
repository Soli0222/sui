import json
import os
from pathlib import Path
import subprocess
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]


class WorkflowShellTest(unittest.TestCase):
    def test_ci_aggregate_rejects_failure_cancellation_and_unexpected_skips(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
        self.assertEqual(set(workflow["jobs"]["required"]["needs"]), set(workflow["jobs"]) - {"required"})
        script = workflow["jobs"]["required"]["steps"][0]["run"]
        for event, results, success in [
            ("pull_request", {"lint": "success", "performance": "success"}, True),
            ("push", {"lint": "success", "performance": "skipped"}, True),
            ("push", {"lint": "success", "chart-guard": "skipped"}, True),
            ("pull_request", {"lint": "success", "chart-guard": "skipped"}, False),
            ("pull_request", {"lint": "success", "performance": "skipped"}, False),
            ("push", {"lint": "skipped", "performance": "skipped"}, False),
            ("pull_request", {"lint": "failure"}, False),
            ("pull_request", {"lint": "cancelled"}, False),
        ]:
            with self.subTest(event=event, results=results):
                result = subprocess.run(["bash", "-euo", "pipefail", "-c", script], env={
                    **os.environ, "EVENT": event,
                    "RESULTS": json.dumps({key: {"result": value} for key, value in results.items()}),
                }, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, success, result.stderr)


if __name__ == "__main__":
    unittest.main()
