"""Merge a release PR only after successful CI, pinning the checked head."""
import json
import os
import subprocess


def candidate(pr, app):
    author = pr.get("author") or {}
    login = author.get("login", "").removeprefix("app/").removesuffix("[bot]")
    return bool(app) and (
        pr["headRefName"] == "release-please--branches--main"
        and not pr["isDraft"]
        and author.get("is_bot") is True
        and login == app
    )


def checks_succeeded(checks):
    required = [check for check in checks if check.get("name") == "CI required"]
    if not required or any(
        check.get("status") != "COMPLETED" or check.get("conclusion") != "SUCCESS"
        for check in required
    ):
        return False
    for check in checks:
        if "status" in check:
            if check["status"] != "COMPLETED" or check.get("conclusion") not in (
                "SUCCESS", "NEUTRAL", "SKIPPED"
            ):
                return False
        elif check.get("state") != "SUCCESS":
            return False
    return True


def main():
    repo = os.environ["GITHUB_REPOSITORY"]

    def gh(*args):
        return subprocess.check_output(["gh", *args, "--repo", repo], text=True)

    prs = json.loads(gh(
        "pr", "list", "--base", "main", "--label", "autorelease: pending",
        "--state", "open", "--json", "number,headRefName,isDraft,author",
    ))
    candidates = [pr for pr in prs if candidate(pr, os.environ.get("RELEASE_APP_SLUG", ""))]
    if len(candidates) > 1:
        raise SystemExit("Multiple release PRs found; refusing to select one.")
    if not candidates:
        print("No pending release-please PR.")
        return
    number = str(candidates[0]["number"])
    view = json.loads(gh(
        "pr", "view", number, "--json", "headRefOid,statusCheckRollup,mergeStateStatus",
    ))
    if not checks_succeeded(view["statusCheckRollup"] or []) or view["mergeStateStatus"] != "CLEAN":
        print("Release PR is not ready with successful CI; leaving it open.")
        return
    gh("pr", "merge", number, "--squash", "--match-head-commit", view["headRefOid"])


if __name__ == "__main__":
    main()
