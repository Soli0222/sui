import { expect, test, type Page } from "@playwright/test";
import {
  resetDatabase,
  seedAccount,
  seedPerson,
  seedSettlement,
  seedSplit,
  seedTransaction,
} from "./helpers/db";

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

test.describe("split settlement dialog", () => {
  test("records a partial settlement, then records the remaining share after reopening", async ({ page }) => {
    const person = await seedPerson({ name: "Taro" });
    await seedSplit({
      date: new Date("2026-07-24T00:00:00Z"),
      description: "Lunch",
      amount: 10000,
      shares: [{ personId: person.id, amount: 10000 }],
    });

    const peoplePromise = waitForApi(page, (path) => path === "/api/people");
    await page.goto("/splits");
    await peoplePromise;

    const settlementsPromise = waitForApi(page, (path) => path === "/api/settlements");
    const settlementsPeoplePromise = waitForApi(page, (path) => path === "/api/people");
    await page.getByRole("radio", { name: "精算" }).click();
    await Promise.all([settlementsPromise, settlementsPeoplePromise]);

    await page.getByRole("button", { name: /精算を記録/ }).click();
    const firstDialog = page.getByRole("dialog");
    await expect(firstDialog).toBeVisible();
    await firstDialog.getByLabel("メンバー").selectOption(person.id);
    await expect(firstDialog.getByText(/Lunch（残額 10,000）/)).toBeVisible();

    await firstDialog.locator('input[type="date"]').fill("2026-07-25");
    await firstDialog.locator('input[placeholder="円"]').fill("5000");
    await firstDialog.getByRole("button", { name: "自動按分" }).click();
    await expect(firstDialog.locator('input[placeholder="金額"]')).toHaveValue("5000");
    const firstSavePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/settlements") && response.request().method() === "POST" && response.ok(),
    );
    await firstDialog.getByRole("button", { name: "保存" }).click();
    await firstSavePromise;
    await expect(firstDialog).toHaveCount(0);
    await expect(page.getByRole("table").getByText("5,000 円")).toBeVisible();

    await page.getByRole("button", { name: /精算を記録/ }).click();
    const secondDialog = page.getByRole("dialog");
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByLabel("メンバー")).toHaveValue("");
    await expect(secondDialog.getByLabel("種別")).toHaveValue("offset");
    await expect(secondDialog.locator('input[type="date"]')).toHaveValue("");
    await expect(secondDialog.locator('input[placeholder="円"]')).toHaveValue("");
    await expect(secondDialog.getByRole("textbox").nth(1)).toHaveValue("");
    const secondSummaryResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/people/${person.id}/summary`,
    );
    await secondDialog.getByLabel("メンバー").selectOption(person.id);
    await expect((await secondSummaryResponse).status()).toBe(200);
    await expect(secondDialog.getByText(/Lunch（残額 5,000）/)).toBeVisible();

    await secondDialog.locator('input[type="date"]').fill("2026-07-26");
    await secondDialog.locator('input[placeholder="円"]').fill("5000");
    await secondDialog.getByRole("button", { name: "自動按分" }).click();
    await expect(secondDialog.locator('input[placeholder="金額"]')).toHaveValue("5000");
    const secondSavePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/settlements") && response.request().method() === "POST" && response.ok(),
    );
    await secondDialog.getByRole("button", { name: "保存" }).click();
    await secondSavePromise;
    await expect(secondDialog).toHaveCount(0);
    await expect(page.getByRole("table").getByText("5,000 円")).toHaveCount(2);

    const membersPeoplePromise = waitForApi(page, (path) => path === "/api/people");
    await page.getByRole("radio", { name: "メンバー" }).click();
    await membersPeoplePromise;
    await expect(page.getByTestId("members-total-outstanding")).toHaveText(/0 円/);

    const returnedSettlementsPromise = waitForApi(page, (path) => path === "/api/settlements");
    const returnedPeoplePromise = waitForApi(page, (path) => path === "/api/people");
    await page.getByRole("radio", { name: "精算" }).click();
    await Promise.all([returnedSettlementsPromise, returnedPeoplePromise]);
    await page.getByRole("button", { name: /精算を記録/ }).click();
    const finalDialog = page.getByRole("dialog");
    await finalDialog.getByLabel("メンバー").selectOption(person.id);
    await expect(finalDialog.getByText("未精算の持分はありません。")).toBeVisible();
  });

  test("shows truncated transfer options and full details without overflowing at 375px", async ({ page }) => {
    const fromAccount = await seedAccount({ name: "From", balance: 0 });
    const toAccount = await seedAccount({ name: "To", balance: 0 });
    const person = await seedPerson({ name: "Taro" });

    await seedSplit({
      date: new Date("2026-07-24T00:00:00Z"),
      description: "Lunch",
      amount: 9000,
      shares: [{ personId: person.id, amount: 4000 }],
    });

    const longDescription = "旅行代の精算と立替金の清算用".repeat(5);
    const transfer = await seedTransaction({
      accountId: fromAccount.id,
      transferToAccountId: toAccount.id,
      type: "transfer",
      date: new Date("2026-07-26T00:00:00Z"),
      description: longDescription,
      amount: 10000,
    });

    await page.setViewportSize({ width: 375, height: 812 });

    const peoplePromise = waitForApi(page, (path) => path === "/api/people");
    await page.goto("/splits");
    await peoplePromise;

    const settlementsPromise = waitForApi(page, (path) => path === "/api/settlements");
    const peoplePromise2 = waitForApi(page, (path) => path === "/api/people");
    await page.getByRole("radio", { name: "精算" }).click();
    await Promise.all([settlementsPromise, peoplePromise2]);

    await page.getByRole("button", { name: "精算を記録" }).click();
    await page.getByRole("dialog").waitFor();

    const summaryPromise = waitForApi(page, (path) =>
      path === `/api/people/${person.id}/summary`,
    );
    await page.getByLabel("メンバー").selectOption(person.id);
    await summaryPromise;

    const transactionsPromise = waitForApi(page, (path) =>
      path === "/api/transactions",
    );
    await page.getByLabel("種別").selectOption("transaction");
    await transactionsPromise;

    await page.getByLabel("振替取引").selectOption(transfer.id);

    const selectedOption = page.getByLabel("振替取引").locator("option:checked");
    await expect(selectedOption).toHaveText(/2026-07-26/);
    await expect(selectedOption).toHaveText(/残り 10,000円/);
    await expect(selectedOption).toHaveText(/…$/);

    await expect(page.getByText(longDescription)).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/総額 10,000 円/)).toHaveText(
      /2026-07-26 \/ 総額 10,000 円/,
    );
    await expect(page.getByRole("dialog").getByText(/精算済み/)).toHaveText(
      /精算済み 0 円 \/ 残額 10,000 円/,
    );

    await assertNoDocumentHorizontalScroll(page);
  });
});
