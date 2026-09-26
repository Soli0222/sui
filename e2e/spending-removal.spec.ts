import { expect, test } from "./helpers/test";
import { navigateTo } from "./helpers/actions";
import { seedAccount, seedRecurringItem, seedTransaction } from "./helpers/db";
import { getFutureDate } from "./helpers/scenario";

test("retired spending UI stays absent while account, schedule, transaction, and forecast remain usable", async ({ page }) => {
  const source = await seedAccount({ name: "Source account", balance: 100000 });
  const destination = await seedAccount({ name: "Destination account", balance: 50000 });
  const forecastDate = getFutureDate(7);
  await seedRecurringItem({ name: "Future transfer", type: "transfer", amount: 5000,
    accountId: source.id, transferToAccountId: destination.id, enabled: true,
    dayOfMonth: Number(forecastDate.slice(8)), startDate: new Date(`${forecastDate}T00:00:00.000Z`) });
  await seedTransaction({ description: "Historical transfer", type: "transfer", amount: 2000,
    accountId: source.id, transferToAccountId: destination.id,
    date: new Date(`${getFutureDate(0)}T00:00:00.000Z`) });
  const spendingRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/spending")) spendingRequests.push(request.url());
  });

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await navigateTo(page, "/accounts");
    await expect(page.getByText("Source account", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "支出決裁" })).toHaveCount(0);
    await page.getByRole("button", { name: "口座を追加" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("補正予算の資金元")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await navigateTo(page, "/recurring");
    await expect(page.getByRole("listitem").filter({ hasText: "Future transfer" })).toBeVisible();
    await navigateTo(page, "/transactions");
    await expect(page.getByText("Historical transfer", { exact: true }).first()).toBeVisible();
    await navigateTo(page, "/");
    await expect(page.getByText("Future transfer", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  }

  await navigateTo(page, "/spending/requests/new");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("main")).toBeVisible();
  expect(spendingRequests).toEqual([]);
});
