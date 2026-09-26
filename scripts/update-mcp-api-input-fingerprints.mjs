import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceDirs = [
  "packages/backend/src/routes",
  "packages/backend/src/schemas",
  "packages/backend/src/lib",
  "packages/backend/src/services",
  "packages/shared/src",
];
function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const source = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(source);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [source] : [];
  });
}
const paths = sourceDirs.flatMap(walk).sort();
const digest = (source) => createHash("sha256").update(source).digest("hex");
const fingerprints = Object.fromEntries(paths.map((source) => [source, digest(readFileSync(path.join(root, source)))]));
const target = path.join(root, "packages/backend/src/mcp/api-input-fingerprints.json");
const previous = JSON.parse(readFileSync(target, "utf8"));
for (const source of new Set([...Object.keys(previous), ...paths])) {
  if (previous[source] !== fingerprints[source]) console.log(source);
}
writeFileSync(target, `${JSON.stringify(fingerprints, null, 2)}\n`);
