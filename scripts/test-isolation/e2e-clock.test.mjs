import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { E2E_NOW, e2eClockEnv } from "./e2e-clock.mjs";

test("ordinary E2E clock and scenario are independent of host timezone and stale environment", () => {
  const results = ["Asia/Tokyo", "UTC", "Pacific/Honolulu"].map((timezone) => {
    const env = e2eClockEnv({ ...process.env, TZ: timezone, SUI_E2E_NOW: "stale" });
    const code = `import { businessNow, getFutureDate, getYearMonth, getForecastDayOfMonth } from "./e2e/helpers/scenario.ts";
      console.log(JSON.stringify({ now: new Date().toISOString(), business: businessNow().toISOString(),
        today: getFutureDate(0), future: getFutureDate(), month: getYearMonth(), next: getYearMonth(1),
        day: getForecastDayOfMonth() }));`;
    return JSON.parse(execFileSync(process.execPath, [
      "--import", path.resolve("packages/backend/node_modules/tsx/dist/loader.mjs"),
      "--input-type=module", "-e", code,
    ], { env, encoding: "utf8" }));
  });
  assert.deepEqual(results[0], {
    now: E2E_NOW, business: E2E_NOW, today: "2026-06-15", future: "2026-06-22",
    month: "2026-06", next: "2026-07", day: 16,
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});
