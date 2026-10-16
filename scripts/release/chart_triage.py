"""Leave appVersion-only pushes to the release pipeline; reconcile other changes."""
import os
import subprocess

import yaml


def reconcile(event, before, after):
    if event != "push":
        return True

    def git(*args):
        return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL)

    try:
        git("cat-file", "-e", before + "^{commit}")
        changed = git("diff", "--name-only", before, after, "--", "charts").splitlines()
        if changed == ["charts/sui/Chart.yaml"]:
            base = yaml.safe_load(git("show", f"{before}:{changed[0]}"))
            head = yaml.safe_load(git("show", f"{after}:{changed[0]}"))
            keys = {key for key in set(base) | set(head) if base.get(key) != head.get(key)}
            return not keys <= {"appVersion"}
    except subprocess.CalledProcessError:
        pass  # A missing before SHA must not prevent recovery.
    return True


if __name__ == "__main__":
    result = reconcile(os.environ["EVENT"], os.environ.get("BEFORE", ""), os.environ.get("AFTER", "HEAD"))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"run={str(result).lower()}\n")
