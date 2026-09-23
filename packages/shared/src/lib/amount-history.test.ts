import { describe, expect, it } from "vitest";
import { resolveDatedAmount } from "./amount-history";

describe("resolveDatedAmount", () => {
  it("uses the latest effective date, including the effective day", () => {
    const changes = [
      { effectiveFrom: "2026-10-01", amount: 1300 },
      { effectiveFrom: "2026-07-01", amount: 1200 },
    ];
    expect(resolveDatedAmount(1000, changes, "2026-06-30")).toBe(1000);
    expect(resolveDatedAmount(1000, changes, "2026-07-01")).toBe(1200);
    expect(resolveDatedAmount(1000, changes, "2026-09-30")).toBe(1200);
    expect(resolveDatedAmount(1000, changes, "2026-10-01")).toBe(1300);
    expect(resolveDatedAmount(1000, [], "2026-10-01")).toBe(1000);
  });
});
