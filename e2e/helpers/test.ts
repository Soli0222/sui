import { test as base } from "@playwright/test";
import { configureDatabase, resetDatabase, stopDatabaseRunner } from "./db";
import { startWorker, type WorkerEnvironment } from "./worker";

export { expect, type Page, type TestInfo } from "@playwright/test";

type StorageState = Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;

export const test = base.extend<{ _resetData: void }, {
  environment: WorkerEnvironment;
  workerStorageState: StorageState;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  environment: [async ({}, use, workerInfo) => {
    const environment = await startWorker(workerInfo.workerIndex);
    configureDatabase(environment.databaseUrl);
    try {
      await use(environment);
    } finally {
      try { await stopDatabaseRunner(); } finally { await environment.stop(); }
    }
  }, { scope: "worker", timeout: 60_000 }],
  workerStorageState: [async ({ browser, environment }, use) => {
    const page = await browser.newPage();
    let state: StorageState;
    try {
      if (process.env.SUI_E2E_NOW) await page.clock.setFixedTime(new Date(process.env.SUI_E2E_NOW));
      await page.goto(`${environment.baseURL}/api/auth/login`);
      await page.waitForURL(`${environment.baseURL}/`);
      state = await page.context().storageState();
    } finally {
      await page.context().close();
    }
    await use(state);
  }, { scope: "worker" }],
  baseURL: async ({ environment }, use) => { await use(environment.baseURL); },
  storageState: async ({ workerStorageState }, use) => { await use(workerStorageState); },
  _resetData: [async ({ environment }, use) => {
    // Depend on the worker environment before any beforeEach hook can seed data.
    void environment;
    await resetDatabase();
    await use();
  }, { auto: true }],
  page: async ({ page }, use) => {
    if (process.env.SUI_E2E_NOW) {
      await page.clock.setFixedTime(new Date(process.env.SUI_E2E_NOW));
    }
    await use(page);
  },
});
