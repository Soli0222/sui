import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PerformanceMetric {
  name: string;
  meanMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  samples: number;
}

export interface PerformanceReport {
  commit: string;
  generatedAt: string;
  benchmarks: PerformanceMetric[];
}

const metrics: PerformanceMetric[] = [];

function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

export async function measurePerformance(
  name: string,
  callback: () => Promise<void>,
  options: { warmup?: number; samples?: number } = {},
) {
  const warmup = options.warmup ?? 3;
  const samples = options.samples ?? 30;

  for (let index = 0; index < warmup; index += 1) {
    await callback();
  }

  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = process.hrtime.bigint();
    await callback();
    durations.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }

  const sum = durations.reduce((total, value) => total + value, 0);
  metrics.push({
    name,
    meanMs: roundMs(sum / durations.length),
    p95Ms: roundMs(percentile(durations, 95)),
    minMs: roundMs(Math.min(...durations)),
    maxMs: roundMs(Math.max(...durations)),
    samples: durations.length,
  });
}

export function getPerformanceReport(): PerformanceReport {
  return {
    commit: process.env.PERF_COMMIT ?? process.env.GITHUB_SHA ?? "local",
    generatedAt: new Date().toISOString(),
    benchmarks: metrics,
  };
}

export async function writePerformanceReport(outputPath = process.env.PERF_OUTPUT ?? "performance-results/head.json") {
  const report = getPerformanceReport();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
