import { expect, test } from "@playwright/test";

test("serves the app shell after an offline reload", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByText("可処分資産予測")).toBeVisible();

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "sui - 可処分資産予測",
    display: "standalone",
  });

  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("service worker is not available");
    }
    await navigator.serviceWorker.ready;
  });

  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "networkidle" });
  }

  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("可処分資産予測")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("可処分資産予測")).toBeVisible();
    await expect(page.getByText("ネットワークに接続できません。通信状態を確認してください。").first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
