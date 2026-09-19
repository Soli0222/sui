import { expect, test } from "./helpers/test";
import { startWorker } from "./helpers/worker";

// Exercise isolation even when the suite is intentionally run with one worker.
test("keeps another worker's data and session when one environment is destroyed", async ({
  page, playwright, environment,
}, testInfo) => {
  const probe = await startWorker(1_000_000 + testInfo.workerIndex);
  const other = await playwright.request.newContext({ baseURL: probe.baseURL });
  try {
    expect(probe.baseURL).not.toBe(environment.baseURL);
    expect(probe.databaseUrl).not.toBe(environment.databaseUrl);
    await other.get("/api/auth/login");
    for (const request of [page.request, other]) {
      const created = await request.post("/api/accounts", {
        data: { name: "Isolated account", balance: 1000, sortOrder: 0 },
      });
      expect(created.ok()).toBe(true);
      const accounts = await request.get("/api/accounts");
      expect(await accounts.json()).toHaveLength(1);
    }
    await other.post("/api/auth/logout");
    await other.dispose();
    await probe.stop();
    const accounts = await page.request.get("/api/accounts");
    expect(accounts.status()).toBe(200);
    expect(await accounts.json()).toHaveLength(1);
  } finally {
    await other.dispose();
    await probe.stop();
  }
});
