import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { calendarEnv, calendarInstant } from "./calendar.mjs";

test("calendar profiles cover February end, year end and new year in JST", () => {
  const now = new Date("2026-09-19T00:00:00Z");
  assert.equal(calendarInstant("month-end", now), "2027-02-28T03:00:00.000Z");
  assert.equal(calendarInstant("year-end", now), "2027-12-31T03:00:00.000Z");
  assert.equal(calendarInstant("new-year", now), "2028-01-01T03:00:00.000Z");
  assert.equal(calendarInstant("month-end", new Date("2026-12-31T15:00:00Z")), "2028-02-29T03:00:00.000Z");
  assert.equal(calendarInstant("live", now), undefined);
  assert.throws(() => calendarInstant("typo", now), /unknown E2E calendar/);
});

test("calendar env preserves options and leaves normal runs on the real clock", () => {
  const live = calendarEnv({ NODE_OPTIONS: "--no-warnings", SUI_E2E_NOW: "stale" });
  assert.equal(live.NODE_OPTIONS, "--no-warnings");
  assert.equal(live.SUI_E2E_NOW, "");
  const future = calendarEnv({ NODE_OPTIONS: "--no-warnings", SUI_E2E_CALENDAR: "new-year" });
  assert.match(future.NODE_OPTIONS, /^--no-warnings --import=file:/);
  assert.ok(Date.parse(future.SUI_E2E_NOW) > Date.now());
});

test("preloaded child freezes Date while preserving explicit dates and real timers", () => {
  const env = calendarEnv({ ...process.env, SUI_E2E_CALENDAR: "month-end" });
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    const start = performance.now();
    await new Promise(resolve => setTimeout(resolve, 20));
    console.log(JSON.stringify({
      now: Date.now(), iso: new Date().toISOString(), callable: Date(),
      explicit: new Date(2026, 0, 1).getFullYear(), epoch: new Date(0).getTime(),
      instance: new Date() instanceof Date, elapsed: performance.now() - start,
    }));
  `], { env, encoding: "utf8", timeout: 5000 }));
  assert.equal(result.iso, env.SUI_E2E_NOW);
  assert.equal(result.now, Date.parse(env.SUI_E2E_NOW));
  assert.equal(result.callable, new Date(env.SUI_E2E_NOW).toString());
  assert.equal(result.explicit, 2026);
  assert.equal(result.epoch, 0);
  assert.equal(result.instance, true);
  assert.ok(result.elapsed >= 10);
});
