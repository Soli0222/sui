import { expect, test } from "./helpers/test";
import { seedAccount } from "./helpers/db";

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

test("previews a replace import, retains it on failure, and confirms the replacement", async ({ page }) => {
  await seedAccount({ name: "Import fixture account" });
  await page.goto("/data");
  const importCard = page.getByRole("heading", { name: "インポート" }).locator("../..");
  const backup = await page.request.get("/api/export");
  expect(backup.ok()).toBe(true);
  const body = await backup.body();
  await page.getByLabel("インポートする JSON ファイル").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: body });
  await expect(page.getByText("Import fixture account")).toHaveCount(0);
  await expect(importCard.getByText("口座", { exact: true }).locator("..")).toContainText("1");
  const execute = page.getByRole("button", { name: "インポートを実行" });
  await expect(execute).toBeDisabled();
  await page.getByLabel("既存の全データが置き換えられることを確認しました。").click();
  await expect(execute).toBeEnabled();

  await page.route("**/api/import", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "replace failed" }) });
  });
  await execute.click();
  await expect(page.getByRole("alert")).toContainText("replace failed");
  await expect(importCard.getByText("口座", { exact: true }).locator("..")).toContainText("1");
  await page.unroute("**/api/import");
  await execute.click();
  await expect(page.getByText("インポートが完了しました。")).toBeVisible();
  await expect(importCard.getByText("口座", { exact: true }).locator("..")).toContainText("1");
});
