import { expect, test } from "@playwright/test";
import { resetDatabase } from "./helpers/db";

test.beforeEach(async () => {
  await resetDatabase();
});

test("shows data management page and downloads export JSON", async ({ page }) => {
  await page.goto("/data");

  await expect(page.getByRole("heading", { name: "データ管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "エクスポート" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "インポート" })).toBeVisible();

  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/export"));
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON をダウンロード" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["content-disposition"]).toMatch(
    /^attachment; filename="sui-export-\d{8}\.json"$/,
  );
  expect(download.suggestedFilename()).toMatch(/^sui-export-\d{8}\.json$/);
});
