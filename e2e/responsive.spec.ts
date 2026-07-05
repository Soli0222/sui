import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { navigateTo } from "./helpers/actions";
import { resetDatabase, seedAccount, seedTransaction } from "./helpers/db";

const viewports = [
  { name: "mobile-375", width: 375, height: 667 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

test.beforeEach(async () => {
  await resetDatabase();
});

async function expectNoDocumentHorizontalScroll(page: Page) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflowingElements = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className.toString(),
          tagName: element.tagName.toLowerCase(),
          text: element.textContent?.trim().slice(0, 80) ?? "",
          right: Math.round(rect.right),
        };
      })
      .filter((element) => element.right > viewportWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 5);

    return {
      viewportWidth,
      bodyOverflow: document.body.scrollWidth - viewportWidth,
      documentOverflow: document.documentElement.scrollWidth - viewportWidth,
      overflowingElements,
    };
  });

  expect(Math.max(metrics.bodyOverflow, metrics.documentOverflow), JSON.stringify(metrics)).toBeLessThanOrEqual(1);
}

async function expectNoTableOverflow(page: Page) {
  // ResponsiveTable はデスクトップ幅 (md 以上) でのみテーブルを表示し、
  // それ未満ではリスト行レイアウトに切り替える。表示中のテーブルは横スクロールに依存しない。
  const table = page.locator("table").first();
  if ((await table.count()) === 0 || !(await table.isVisible())) {
    return;
  }

  const tableWrapper = table.locator("..");
  const metrics = await tableWrapper.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function captureResponsiveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test("keeps primary screens inside the viewport at responsive sizes", async ({ page }, testInfo) => {
  const account = await seedAccount({
    name: "とても長い口座名でもモバイル幅で本文を横スクロールさせない確認用口座",
    balance: 1_234_567_890,
    balanceOffset: 12_345,
    sortOrder: 1,
  });
  await seedTransaction({
    accountId: account.id,
    date: new Date("2026-06-01T00:00:00+09:00"),
    type: "expense",
    description: "長い取引内容でもテーブル内スクロールに閉じ込める確認用の支出",
    amount: 98_765,
  });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await navigateTo(page, "/");
    await expect(page.getByRole("heading", { name: "残高推移" })).toBeVisible();
    await expectNoDocumentHorizontalScroll(page);

    if (viewport.width < 1024) {
      await expect(page.getByRole("navigation", { name: "モバイルナビゲーション" })).toBeVisible();
      const headerHeight = await page.locator("header").evaluate((element) => element.getBoundingClientRect().height);
      expect(headerHeight).toBeLessThan(96);
    }

    await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-dashboard`);

    await navigateTo(page, "/transactions");
    await expect(page.getByRole("heading", { name: "取引履歴" })).toBeVisible();
    await expectNoDocumentHorizontalScroll(page);
    await expectNoTableOverflow(page);

    await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-transactions`);
  }
});

test("uses a bottom tab bar for mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateTo(page, "/");

  const mobileNav = page.getByRole("navigation", { name: "モバイルナビゲーション" });
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "ダッシュボード" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "取引" })).toBeVisible();

  await mobileNav.getByRole("button", { name: "資産" }).click();
  await page.getByRole("link", { name: "クレカ管理" }).click();
  await expect(page.getByRole("heading", { name: "クレジットカード管理" })).toBeVisible();
  await expectNoDocumentHorizontalScroll(page);
});
