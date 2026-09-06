import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { expect, it } from "vitest";
import type { SpendingResponse } from "@sui/shared";
import { createTestApp } from "../test-helpers/app";
import { testPrisma } from "../test-helpers/db";

it.each(["spending", "phase1"])(
  "seed.sh %s prepares synthetic MF months without requests and preserves repeated spending seed",
  async (phase) => {
    const temp = await mkdtemp(join(tmpdir(), "sui-seed-check-"));
    const app = createTestApp();
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test port");
    const base = `http://127.0.0.1:${address.port}`;
    const script = fileURLToPath(
      new URL("../../../../scripts/seed.sh", import.meta.url),
    );
    const run = (selected = "spending") =>
      promisify(execFile)("bash", [script, selected, base], {
        env: { ...process.env, TMPDIR: temp, SUI_SEED_API_TOKEN: "" },
        timeout: 30000,
      });
    try {
      const result = await run(phase);
      expect(result.stdout).toContain("申請は作成していません");
      const state = (await (
        await app.request("/api/spending")
      ).json()) as SpendingResponse;
      expect(state.ledger.requests).toEqual([]);
      expect(state.ledger.settings).toMatchObject({
        threshold: 10000,
        freshnessDays: 7,
        approvalDays: 14,
        fundingDays: 30,
        ai: null,
      });
      expect(state.ledger.imports.filter((i) => i.committed)).toHaveLength(4);
      expect(
        state.ledger.details.every((d) => d.sourceId?.startsWith("sui-seed-")),
      ).toBe(true);
      expect(state.ledger.plans).toHaveLength(0);
      expect(state.ledger.allocations).toHaveLength(0);
      expect(state.ledger.budgetProposals).toHaveLength(1);
      if (phase === "spending") {
        expect(await testPrisma.transaction.count()).toBe(0);
        expect(await testPrisma.recurringItem.count()).toBe(0);
      }
      const currentMonth = state.ledger.imports.at(-1)!.month;
      const current = state.calculations.filter(
        (c) => c.month === currentMonth,
      );
      expect(current).toHaveLength(3);
      expect(
        current.every((c) => c.missing.length === 0 && c.remaining! > 0),
      ).toBe(true);
      expect(
        await testPrisma.account.count({
          where: { supplementalBudgetEnabled: true },
        }),
      ).toBe(1);
      const artifacts = join(temp, (await readdir(temp))[0]);
      const backup = JSON.parse(
        await readFile(join(artifacts, "before-seed.json"), "utf8"),
      );
      expect(backup.data.accounts).toEqual([]);
      expect(
        (await readdir(join(artifacts, "mf-csv"))).filter((f) =>
          f.endsWith(".csv"),
        ),
      ).toHaveLength(4);
      const second = await run();
      expect(second.stdout).toContain("スキップ");
      const repeated = (await (
        await app.request("/api/spending")
      ).json()) as SpendingResponse;
      expect(repeated.version).toBe(state.version);
      expect(await testPrisma.account.count()).toBe(
        phase === "spending" ? 2 : 5,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(temp, { recursive: true, force: true });
    }
  },
  40000,
);
