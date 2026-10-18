import assert from "node:assert/strict";
import { test } from "node:test";
import { getCurrentDates, getDate, getOneTimeSchedule, getYear, getYearMonth } from "./scenario";

test("scenario data follows the run date in Japan without replacing the clock", () => {
  const previous = process.env.SUI_E2E_STARTED_AT;
  const nativeDate = Date;
  const before = Date.now();
  try {
    for (const month of ["06", "07"]) {
      process.env.SUI_E2E_STARTED_AT = `2030-${month}-14T15:00:00.000Z`;
      assert.equal(getDate(), `2030-${month}-15`);
      assert.equal(getYearMonth(), `2030-${month}`);
      assert.equal(getYear(), 2030);
    }
    assert.equal(Date, nativeDate);
    assert.ok(Date.now() >= before);
  } finally {
    if (previous === undefined) delete process.env.SUI_E2E_STARTED_AT;
    else process.env.SUI_E2E_STARTED_AT = previous;
  }
});

test("UI dates follow the time a form opens even after the scenario day, month or year ends", () => {
  const previous = process.env.SUI_E2E_STARTED_AT;
  try {
    for (const [startedAt, openedAt, scenarioDay, uiDay] of [
      ["2030-06-15T14:59:00Z", "2030-06-15T15:01:00Z", "2030-06-15", "2030-06-16"],
      ["2030-06-30T14:59:00Z", "2030-06-30T15:01:00Z", "2030-06-30", "2030-07-01"],
      ["2030-12-31T14:59:00Z", "2030-12-31T15:01:00Z", "2030-12-31", "2031-01-01"],
    ]) {
      process.env.SUI_E2E_STARTED_AT = startedAt;
      assert.equal(getDate(), scenarioDay);
      assert.deepEqual(getCurrentDates(new Date(openedAt), new Date(openedAt)), [uiDay]);
      assert.deepEqual(getCurrentDates(new Date(startedAt), new Date(openedAt)), [scenarioDay, uiDay]);
    }
  } finally {
    if (previous === undefined) delete process.env.SUI_E2E_STARTED_AT;
    else process.env.SUI_E2E_STARTED_AT = previous;
  }
});

test("a future UI event stays a single occurrence when tomorrow is in another year", () => {
  const previous = process.env.SUI_E2E_STARTED_AT;
  try {
    process.env.SUI_E2E_STARTED_AT = "2030-12-31T03:00:00.000Z";
    const schedule = getOneTimeSchedule();
    assert.equal(getYearMonth(1), "2031-01");
    assert.equal(getDate(-1), "2030-12-30");
    assert.equal(schedule.dayOfMonth, 1);
    assert.equal(schedule.startDate.toISOString(), "2031-01-01T00:00:00.000Z");
    assert.equal(schedule.endDate.toISOString(), schedule.startDate.toISOString());
    assert.equal(schedule.dateShiftPolicy, "none");
  } finally {
    if (previous === undefined) delete process.env.SUI_E2E_STARTED_AT;
    else process.env.SUI_E2E_STARTED_AT = previous;
  }
});
