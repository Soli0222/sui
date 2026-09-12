import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const env = { ...process.env };
// Nested make must not inherit the test runner's literal input or jobserver flags.
for (const key of ["MAKEFLAGS", "MFLAGS", "MAKELEVEL", "MAKEOVERRIDES", "SUI_VERSION_INPUT", "VERSION"]) delete env[key];

test("checks the current release and rejects mismatches", () => {
  assert.equal(spawnSync("make", ["version-check", `VERSION=${version}`], { cwd: root, env }).status, 0);
  assert.notEqual(spawnSync("make", ["version-check", "VERSION=0.0.0"], { cwd: root, env }).status, 0);
});

test("never evaluates shell syntax or Make functions in version inputs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "sui-version-"));
  const marker = path.join(directory, "executed");
  try {
    const values = [
      `${version};touch$${"$"}{IFS}${marker}`,
      `${version}";touch ${marker};#`,
      `$(shell touch ${marker})`,
      `$(file >${marker},executed)`,
      "v1.2.3", "1.2.3\ninvalid",
    ];
    for (const target of ["version-check", "version-set"]) {
      for (const value of values) {
        const result = spawnSync("make", [target, `VERSION=${value}`], { cwd: root, env, encoding: "utf8" });
        assert.notEqual(result.status, 0, `${target} accepted ${value}`);
        assert.equal(existsSync(marker), false, `${target} evaluated ${value}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
