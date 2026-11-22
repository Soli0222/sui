import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import yaml

import chart_triage


ROOT = Path(__file__).resolve().parents[2]


class GitFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.old_directory = Path.cwd()
        os.chdir(self.directory)
        self.addCleanup(os.chdir, self.old_directory)
        self.git("init", "-q")
        self.git("config", "user.name", "Release fixture")
        self.git("config", "user.email", "release@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")
        self.git("config", "core.hooksPath", "/dev/null")
        self.chart = self.directory / "charts/sui/Chart.yaml"
        self.chart.parent.mkdir(parents=True)
        self.chart.write_text('name: sui\nversion: 0.9.1\nappVersion: "2.2.1"\n')
        self.commit()
        self.before = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")


class ChartTriageTest(GitFixture):
    def test_app_version_and_yaml_reformatting_belong_to_release_pipeline(self):
        self.chart.write_text("# reformatted by release-please\nname: sui\nversion: 0.9.1\nappVersion: 2.2.2\n")
        self.commit()
        self.assertFalse(chart_triage.reconcile("push", self.before, "HEAD"))

    def test_chart_version_and_template_changes_still_reconcile(self):
        self.chart.write_text("name: sui\nversion: 0.10.0\nappVersion: 2.2.2\n")
        self.commit()
        self.assertTrue(chart_triage.reconcile("push", self.before, "HEAD"))
        before = self.git("rev-parse", "HEAD").strip()
        (self.chart.parent / "values.yaml").write_text("replicaCount: 2\n")
        self.commit()
        self.assertTrue(chart_triage.reconcile("push", before, "HEAD"))

    def test_recovery_does_not_require_a_push_diff(self):
        for event in ["schedule", "workflow_dispatch"]:
            self.assertTrue(chart_triage.reconcile(event, "", "HEAD"))
        self.assertTrue(chart_triage.reconcile("push", "0" * 40, "HEAD"))


class ResolveTagTest(GitFixture):
    def setUp(self):
        super().setUp()
        self.output = self.directory / "output"
        self.called = self.directory / "called"
        gh = self.directory / "gh"
        gh.write_text('#!/bin/sh\nprintf called > "$CALLED"\nprintf "%s" "$RELEASE_JSON"\n')
        gh.chmod(0o755)

    def resolve(self, version, **release):
        return subprocess.run(["bash", str(ROOT / "scripts/release/resolve_tag.sh")], env={
            **os.environ, "PATH": str(self.directory) + os.pathsep + os.environ["PATH"],
            "VERSION": version, "GITHUB_REPOSITORY": "owner/sui", "GITHUB_OUTPUT": str(self.output),
            "CALLED": str(self.called), "RELEASE_JSON": json.dumps({"tagName": version, "isDraft": False, **release}),
        }, capture_output=True, text=True)

    def test_released_stable_and_rc_tags_resolve_to_their_commits(self):
        for version in ["2.2.1", "2.3.0-rc.1"]:
            with self.subTest(version=version):
                self.git("tag", "-a", version, "-m", "release")
                self.output.unlink(missing_ok=True)
                result = self.resolve(version)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.output.read_text(), f"sha={self.before}\n")

    def test_missing_tag_draft_and_mismatched_release_are_rejected(self):
        self.assertNotEqual(self.resolve("2.2.2").returncode, 0)
        self.git("tag", "2.2.1")
        self.assertNotEqual(self.resolve("2.2.1", isDraft=True).returncode, 0)
        self.assertNotEqual(self.resolve("2.2.1", tagName="other").returncode, 0)
        self.assertFalse(self.output.exists())

    def test_invalid_input_is_rejected_before_calling_github(self):
        for version in ["v2.2.1", "main", "2.2.1\ninvalid", "2.2.1;touch marker", "$(touch marker)"]:
            with self.subTest(version=version):
                self.assertNotEqual(self.resolve(version).returncode, 0)
                self.assertFalse(self.called.exists())
                self.assertFalse((self.directory / "marker").exists())


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

    def test_latest_updates_only_for_the_current_stable_release(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/docker.yaml").read_text())
        script = workflow["jobs"]["latest"]["steps"][-1]["run"]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            gh = directory / "gh"
            gh.write_text('#!/bin/sh\nprintf "%s" "$LATEST_RELEASE"\n')
            gh.chmod(0o755)
            docker = directory / "docker"
            docker.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$DOCKER_ARGS"\n')
            docker.chmod(0o755)
            arguments = directory / "docker-args"
            for version, latest, updated in [
                ("2.2.1", "2.2.1", True),
                ("2.2.1", "2.3.0", False),
                ("2.3.0-rc.1", "2.2.1", False),
                ("2.3.0-rc.1", "2.3.0-rc.1", False),
            ]:
                with self.subTest(version=version, latest=latest):
                    arguments.unlink(missing_ok=True)
                    result = subprocess.run(["bash", "-c", script], env={
                        **os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"],
                        "RELEASE_VERSION": version, "LATEST_RELEASE": latest,
                        "GITHUB_REPOSITORY": "Owner/sui", "DOCKER_ARGS": str(arguments),
                    }, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(arguments.exists(), updated)
                    if updated:
                        self.assertEqual(arguments.read_text().splitlines(), [
                            "buildx", "imagetools", "create", "-t", "ghcr.io/owner/sui:latest",
                            "ghcr.io/owner/sui:2.2.1",
                        ])
