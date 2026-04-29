import { describe, expect, it } from "vitest";
import { adjustToBusinessDay, isBusinessDay } from "./business-day";

describe("isBusinessDay", () => {
  it("returns true only for weekdays that are not Japanese holidays", () => {
    expect(isBusinessDay("2026-05-01")).toBe(true);
    expect(isBusinessDay("2026-05-02")).toBe(false);
    expect(isBusinessDay("2026-05-03")).toBe(false);
    expect(isBusinessDay("2026-05-04")).toBe(false);
  });
});

describe("adjustToBusinessDay", () => {
  it("keeps business days and none policy unchanged", () => {
    expect(adjustToBusinessDay("2026-05-01", "previous")).toBe("2026-05-01");
    expect(adjustToBusinessDay("2026-05-02", "none")).toBe("2026-05-02");
  });

  it("moves non-business days to the previous business day across month boundaries", () => {
    expect(adjustToBusinessDay("2026-05-03", "previous")).toBe("2026-05-01");
    expect(adjustToBusinessDay("2026-08-01", "previous")).toBe("2026-07-31");
  });

  it("moves non-business days to the next business day across month boundaries", () => {
    expect(adjustToBusinessDay("2026-05-03", "next")).toBe("2026-05-07");
    expect(adjustToBusinessDay("2026-05-31", "next")).toBe("2026-06-01");
  });
});
