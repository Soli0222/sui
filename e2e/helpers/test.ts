import { test as base } from "@playwright/test";

export { expect, type Page, type TestInfo } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    if (process.env.SUI_E2E_NOW) {
      await page.clock.setFixedTime(new Date(process.env.SUI_E2E_NOW));
    }
    await use(page);
  },
});
