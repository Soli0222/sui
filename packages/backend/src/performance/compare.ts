import { readFile, writeFile } from "node:fs/promises";
import type { PerformanceMetric, PerformanceReport } from "./report";

interface ComparisonRow {
  name: string;
  base: PerformanceMetric;
  head: PerformanceMetric;
  diffMs: number;
  diffPercent: number;
  regression: boolean;
}

const RELATIVE_THRESHOLD = Number(process.env.PERF_REGRESSION_PERCENT ?? 20);
const ABSOLUTE_THRESHOLD_MS = Number(process.env.PERF_REGRESSION_MS ?? 50);

function formatMs(value: number) {
  return `${value.toFixed(2)} ms`;
}

function formatSignedMs(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} ms`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function compareReports(base: PerformanceReport, head: PerformanceReport): ComparisonRow[] {
  const baseByName = new Map(base.benchmarks.map((benchmark) => [benchmark.name, benchmark]));

  return head.benchmarks.flatMap((headMetric) => {
    const baseMetric = baseByName.get(headMetric.name);
    if (!baseMetric) {
      return [];
    }

    const diffMs = headMetric.meanMs - baseMetric.meanMs;
    const diffPercent = baseMetric.meanMs === 0 ? 0 : (diffMs / baseMetric.meanMs) * 100;
    const regression = diffPercent > RELATIVE_THRESHOLD && diffMs > ABSOLUTE_THRESHOLD_MS;

    return [{
      name: headMetric.name,
      base: baseMetric,
      head: headMetric,
      diffMs,
      diffPercent,
      regression,
    }];
  });
}

function renderMarkdown(rows: ComparisonRow[], base: PerformanceReport, head: PerformanceReport) {
  const lines = [
    "## Performance",
    "",
    `Base: \`${base.commit.slice(0, 7)}\` / Head: \`${head.commit.slice(0, 7)}\``,
    "",
    "| benchmark | base mean | head mean | diff | p95 diff | result |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const row of rows) {
    lines.push(`| ${[
      row.name,
      formatMs(row.base.meanMs),
      formatMs(row.head.meanMs),
      `${formatSignedMs(row.diffMs)} (${formatPercent(row.diffPercent)})`,
      formatSignedMs(row.head.p95Ms - row.base.p95Ms),
      row.regression ? "regression" : "ok",
    ].join(" | ")} |`);
  }

  lines.push(
    "",
    `Threshold: regression when mean is slower by both +${RELATIVE_THRESHOLD}% and +${ABSOLUTE_THRESHOLD_MS} ms.`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [basePath, headPath, markdownPath] = process.argv.slice(2);
  if (!basePath || !headPath || !markdownPath) {
    throw new Error("Usage: tsx src/performance/compare.ts <base.json> <head.json> <output.md>");
  }

  const base = JSON.parse(await readFile(basePath, "utf8")) as PerformanceReport;
  const head = JSON.parse(await readFile(headPath, "utf8")) as PerformanceReport;
  const rows = compareReports(base, head);

  if (rows.length === 0) {
    throw new Error("No matching performance benchmarks found.");
  }

  await writeFile(markdownPath, renderMarkdown(rows, base, head));

  const regressions = rows.filter((row) => row.regression);
  if (regressions.length > 0) {
    throw new Error(`Performance regression detected: ${regressions.map((row) => row.name).join(", ")}`);
  }
}

await main();
