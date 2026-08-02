import { expect, test, type Page } from "@playwright/test";
import { resetDatabase, seedPerson, seedSplit, seedSettlement } from "./helpers/db";

async function assertNoDocumentHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function waitForApi(page: Page, pathPredicate: (url: string) => boolean) {
  return page.waitForResponse(
    (response) => {
      try {
        const url = new URL(response.url());
        return pathPredicate(url.pathname) && response.status() === 200;
      } catch {
        return false;
      }
    },
    { timeout: 5000 },
  );
}

test.beforeEach(async () => {
  await resetDatabase();
});

test.describe("split list table", () => {
  test("keeps columns readable and scrolls inside its wrapper at narrow desktop widths", async ({ page }) => {
    const personA = await seedPerson({ name: "Taro" });
    const personB = await seedPerson({ name: "Hanako" });

    const activeDescription = "未精算の割り勘：旅行代の精算と立替金の清算用".repeat(2);
    const archivedDescription = "精算済みの割り勘：旅行代の精算と立替金の清算用".repeat(2);

    await seedSplit({
      date: new Date("2026-07-24T00:00:00Z"),
      description: activeDescription,
      amount: 10000,
      shares: [
        { personId: personA.id, amount: 4000 },
        { personId: personB.id, amount: 3000 },
      ],
    });

    const archivedSplit = await seedSplit({
      date: new Date("2026-07-23T00:00:00Z"),
      description: archivedDescription,
      amount: 7000,
      shares: [{ personId: personA.id, amount: 7000 }],
    });
    await seedSettlement({
      kind: "offset",
      personId: personA.id,
      date: new Date("2026-07-25T00:00:00Z"),
      allocations: [{ shareId: archivedSplit.shares[0].id, amount: 7000 }],
    });

    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });

      const peoplePromise = waitForApi(page, (path) => path === "/api/people");
      await page.goto("/splits");
      await peoplePromise;

      const splitsPromise = waitForApi(page, (path) => path === "/api/splits");
      const peoplePromise2 = waitForApi(page, (path) => path === "/api/people");
      await page.getByRole("radio", { name: "割り勘一覧" }).click();
      await Promise.all([splitsPromise, peoplePromise2]);

      const tables = page.locator("table");
      await expect(tables).toHaveCount(2);
      for (const table of await tables.all()) {
        await expect(table).toHaveClass(/min-w-\[60rem\]/);
      }

      await expect(page.getByText(activeDescription)).toBeVisible();

      // The archived table is still collapsed; measure only the visible active table.
      const activeTable = tables.first();
      const activeWrapperScroll = await activeTable.evaluate((table) => {
        const wrapper = table.parentElement;
        return wrapper ? wrapper.scrollWidth > wrapper.clientWidth : false;
      });
      if (width === 768) {
        expect(activeWrapperScroll).toBe(true);
      }

      // Open the archived section and verify both table wrappers.
      await page.locator("details summary").filter({ hasText: /精算済み/ }).click();
      await expect(page.getByText(archivedDescription)).toBeVisible();

      const visibleTables = page.locator("table");
      await expect(visibleTables).toHaveCount(2);
      for (const table of await visibleTables.all()) {
        await expect(table).toHaveClass(/min-w-\[60rem\]/);
      }

      const wrapperScrolls = await visibleTables.evaluateAll((tables) =>
        tables.map((table) => {
          const wrapper = table.parentElement;
          return wrapper ? wrapper.scrollWidth > wrapper.clientWidth : false;
        }),
      );
      if (width === 768) {
        expect(wrapperScrolls.every(Boolean)).toBe(true);
      }

      await assertNoDocumentHorizontalScroll(page);
    }
  });

  test("switches to mobile cards at 375px", async ({ page }) => {
    const personA = await seedPerson({ name: "Taro" });

    const activeDescription = "未精算の割り勘：旅行代の精算と立替金の清算用".repeat(2);
    const archivedDescription = "精算済みの割り勘：旅行代の精算と立替金の清算用".repeat(2);

    await seedSplit({
      date: new Date("2026-07-24T00:00:00Z"),
      description: activeDescription,
      amount: 10000,
      shares: [{ personId: personA.id, amount: 4000 }],
    });

    const archivedSplit = await seedSplit({
      date: new Date("2026-07-23T00:00:00Z"),
      description: archivedDescription,
      amount: 7000,
      shares: [{ personId: personA.id, amount: 7000 }],
    });
    await seedSettlement({
      kind: "offset",
      personId: personA.id,
      date: new Date("2026-07-25T00:00:00Z"),
      allocations: [{ shareId: archivedSplit.shares[0].id, amount: 7000 }],
    });

    await page.setViewportSize({ width: 375, height: 812 });

    const peoplePromise = waitForApi(page, (path) => path === "/api/people");
    await page.goto("/splits");
    await peoplePromise;

    const splitsPromise = waitForApi(page, (path) => path === "/api/splits");
    const peoplePromise2 = waitForApi(page, (path) => path === "/api/people");
    await page.getByRole("radio", { name: "割り勘一覧" }).click();
    await Promise.all([splitsPromise, peoplePromise2]);

    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.getByText(activeDescription)).toBeVisible();

    await page.locator("details summary").filter({ hasText: /精算済み/ }).click();
    await expect(page.getByText(archivedDescription)).toBeVisible();

    await assertNoDocumentHorizontalScroll(page);
  });
});
