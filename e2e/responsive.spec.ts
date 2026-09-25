import { expect, test, type Page, type TestInfo } from "./helpers/test";
import { navigateTo } from "./helpers/actions";
import { seedAccount, seedCreditCard, seedDonation, seedLoan, seedPerson, seedRecurringItem, seedSalary, seedSplit, seedSubscription, seedTransaction } from "./helpers/db";
import { getFutureDate, getYearMonth } from "./helpers/scenario";

const viewports = [
  { name: "mobile-320", width: 320, height: 600 },
  { name: "mobile-375", width: 375, height: 667 },
  { name: "mobile-414", width: 414, height: 844 },
  { name: "boundary-767", width: 767, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 900 },
];

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

async function expectRecordFits(page: Page, text: string, cardAction = false) {
  const target = cardAction
    ? page.getByRole("button", { name: `${text}を編集` }).locator("xpath=ancestor::li")
    : page.getByText(text, { exact: true }).filter({ visible: true }).first();
  await expect(target).toBeVisible();
  const metrics = await target.evaluate((element) => {
    const record = element.closest("li, tr");
    const region = record?.closest("ul") ?? record?.closest("table")?.parentElement;
    if (!record || !region) throw new Error("表示中のカードまたは表行がありません");
    return { recordRight: record.getBoundingClientRect().right,
      regionWidth: region.clientWidth, regionScrollWidth: region.scrollWidth,
      viewportWidth: document.documentElement.clientWidth };
  });
  expect(metrics.recordRight, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.regionScrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.regionWidth + 1);
}

async function captureResponsiveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test("keeps primary screens inside the viewport at responsive sizes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const account = await seedAccount({
    name: "とても長い口座名でもモバイル幅で本文を横スクロールさせない確認用口座",
    balance: 1_234_567_890,
    balanceOffset: 12_345,
    sortOrder: 1,
  });
  await seedTransaction({
    accountId: account.id,
    date: new Date(`${getFutureDate(0)}T00:00:00.000Z`),
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

    await navigateTo(page, "/accounts");
    await expectRecordFits(page, "とても長い口座名でもモバイル幅で本文を横スクロールさせない確認用口座");
    await expectNoDocumentHorizontalScroll(page);
    await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-accounts`);

    await navigateTo(page, "/transactions");
    await expect(page.getByRole("heading", { name: "取引履歴" })).toBeVisible();
    await expect(page.getByText("長い取引内容でもテーブル内スクロールに閉じ込める確認用の支出", { exact: true })).toBeVisible();
    await expectNoDocumentHorizontalScroll(page);
    await expectRecordFits(page, "長い取引内容でもテーブル内スクロールに閉じ込める確認用の支出");

    await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-transactions`);
  }
});

test("keeps record cards readable at every target width", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const account = await seedAccount({ name: "カード表示確認口座", balance: 987654321, balanceOffset: 12345 });
  const longName = "長い予定収支名と英数字ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  await seedRecurringItem({ name: longName, type: "transfer", amount: 1234567,
    accountId: account.id, transferToAccountId: null, startDate: new Date(getFutureDate(-10)), endDate: new Date(getFutureDate(30)) });
  await seedCreditCard({ name: "長いクレジットカード名ABCDEFGHIJKLMNOPQRSTUVWXYZ", accountId: account.id,
    assumptions: [
      { amount: 0, startMonth: null, endMonth: getYearMonth(0) },
      { amount: 234567, startMonth: getYearMonth(1), endMonth: null },
    ] });
  await seedSubscription({ name: "長いサブスク名ABCDEFGHIJKLMNOPQRSTUVWXYZ", amount: 34567,
    currencyCode: "USD", exchangeRateToJpy: 150,
    startDate: new Date(getFutureDate(-40)), paymentSource: "とても長い支払元名ABCDEFGHIJKLMNOPQRSTUVWXYZ" });
  await seedDonation({ recipient: "長い自治体名ABCDEFGHIJKLMNOPQRSTUVWXYZ", amount: 45678,
    memo: "折り返して読むための長い寄付メモABCDEFGHIJKLMNOPQRSTUVWXYZ", donatedOn: new Date(getFutureDate(0)) });
  await seedLoan({ name: "長いローン名ABCDEFGHIJKLMNOPQRSTUVWXYZ", totalAmount: 987654, accountId: account.id,
    startDate: new Date(getFutureDate(-7)), paymentCount: 24 });
  await seedSalary({ name: "長い給与名称ABCDEFGHIJKLMNOPQRSTUVWXYZ", grossAmount: 500000,
    paidOn: new Date(getFutureDate(0)) });
  const person = await seedPerson({ name: "長いメンバー名ABCDEFGHIJKLMNOPQRSTUVWXYZ", memo: "長いメモABCDEFGHIJKLMNOPQRSTUVWXYZ" });
  const secondPerson = await seedPerson({ name: "二人目のメンバー", memo: "二人目のメモ" });
  await seedSplit({ date: new Date(getFutureDate(-1)), description: "長い割り勘内容ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    amount: 10000, shares: [{ personId: person.id, amount: 4000 }, { personId: secondPerson.id, amount: 2000 }] });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await navigateTo(page, "/");
    await expectRecordFits(page, longName);
    await expectNoDocumentHorizontalScroll(page);
    if ([320, 1280].includes(viewport.width)) await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-forecast`);
    for (const [path, name] of [
      ["/recurring", longName],
      ["/subscriptions", "長いサブスク名ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      ["/credit-cards", "長いクレジットカード名ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      ["/furusato", "長い自治体名ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    ] as const) {
      await navigateTo(page, path);
      await expectRecordFits(page, name, true);
      if (viewport.width === 1280) {
        const height = await page.getByRole("button", { name: `${name}を編集` })
          .locator("xpath=ancestor::li").evaluate((element) => element.getBoundingClientRect().height);
        expect(height, `${path} のカードが縦に間延びしています`).toBeLessThan(145);
      }
      if (path === "/credit-cards") {
        const card = page.getByRole("button", { name: `${name}を編集` }).locator("xpath=ancestor::li");
        await expect(card).toContainText("￥0");
        await expect(card).toContainText("￥234,567");
      }
      if (path === "/subscriptions") {
        const card = page.getByRole("button", { name: `${name}を編集` }).locator("xpath=ancestor::li");
        await expect(card).toContainText("$345.67");
      }
      await expectNoDocumentHorizontalScroll(page);
      if ([320, 768, 1280, 1920].includes(viewport.width)) await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-${path.slice(1)}`);
    }
    await navigateTo(page, "/splits");
    await expectRecordFits(page, "長いメンバー名ABCDEFGHIJKLMNOPQRSTUVWXYZ", true);
    await page.getByRole("radio", { name: "割り勘一覧" }).click();
    await expectRecordFits(page, "長い割り勘内容ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    await expectNoDocumentHorizontalScroll(page);
    if ([320, 1280].includes(viewport.width)) await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-splits`);
    await navigateTo(page, "/salaries");
    await expectRecordFits(page, "長い給与名称ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    await expectNoDocumentHorizontalScroll(page);
    if ([320, 1280].includes(viewport.width)) await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-salaries`);
    await navigateTo(page, "/loans");
    const loan = page.getByText("長いローン名ABCDEFGHIJKLMNOPQRSTUVWXYZ", { exact: true }).first();
    await expect(loan).toBeVisible();
    await expectNoDocumentHorizontalScroll(page);
    if ([320, 1280].includes(viewport.width)) await captureResponsiveScreenshot(page, testInfo, `${viewport.name}-loans`);
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

test("keeps forms and discard confirmations above mobile navigation", async ({ page }) => {
  await seedAccount({ name: "重なり順を確認する口座", balance: 1000 });
  await page.setViewportSize({ width: 320, height: 600 });
  await navigateTo(page, "/accounts");
  await expect(page.getByText("重なり順を確認する口座").first()).toBeVisible();

  const mobileNav = page.getByRole("navigation", { name: "モバイルナビゲーション" });
  await page.getByRole("button", { name: "口座を追加" }).click();
  const formDialog = page.getByRole("dialog", { name: "口座を追加" });
  await expect(formDialog).toBeVisible();
  const standardLayers = await page.evaluate(() => ({
    dialog: Number(getComputedStyle(document.querySelector<HTMLElement>('[role="dialog"]')!).zIndex),
    nav: Number(getComputedStyle(document.querySelector<HTMLElement>('[aria-label="モバイルナビゲーション"]')!).zIndex),
  }));
  expect(standardLayers.dialog).toBeGreaterThan(standardLayers.nav);
  await formDialog.getByRole("button", { name: "キャンセル" }).click();

  await page.getByRole("button", { name: /を削除/ }).first().click();
  const confirm = page.getByRole("dialog", { name: "口座を削除しますか？" });
  await expect(confirm).toBeVisible();
  const confirmationLayers = await page.evaluate(() => ({
    dialog: Number(getComputedStyle(document.querySelector<HTMLElement>('[role="dialog"]')!).zIndex),
    overlay: Number(getComputedStyle(document.querySelector<HTMLElement>('.dialog-overlay[data-state="open"]')!).zIndex),
    nav: Number(getComputedStyle(document.querySelector<HTMLElement>('[aria-label="モバイルナビゲーション"]')!).zIndex),
  }));
  expect(confirmationLayers.dialog).toBeGreaterThan(standardLayers.dialog);
  expect(confirmationLayers.overlay).toBe(confirmationLayers.dialog);
  expect(confirmationLayers.dialog).toBeGreaterThan(confirmationLayers.nav);
  await expect(mobileNav).toBeHidden();
});
