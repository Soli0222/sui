import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Route handlers keep some Zod schemas inline and others in schemas/services.
// Lock the complete route source, plus shared validation sources: any change to
// accepted fields, defaults, enum values, nullability or query handling requires
// a conscious review of MCP inputs and an updated fingerprint fixture.
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sourceDirs = [
  "packages/backend/src/routes",
  "packages/backend/src/schemas",
  "packages/backend/src/lib",
  "packages/backend/src/services",
  "packages/shared/src",
];
const locked = JSON.parse(readFileSync(new URL("../api-input-fingerprints.json", import.meta.url), "utf8")) as Record<string, string>;

function digest(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function sources() {
  function walk(dir: string): string[] {
    return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const source = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(source);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
        ? [source] : [];
    });
  }
  return sourceDirs.flatMap(walk).sort();
}

describe("API input review fingerprints", () => {
  it("requires MCP input review when an API route or validation source changes", () => {
    const current = Object.fromEntries(sources().map((source) => [source, digest(readFileSync(path.join(root, source), "utf8"))]));
    expect(current).toEqual(locked);
  });
});
