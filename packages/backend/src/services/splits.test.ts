import { describe, expect, it } from "vitest";
import { calculateShareAmounts } from "./splits";
import { BadRequestError } from "../lib/http";

describe("calculateShareAmounts", () => {
  describe("equal method", () => {
    it("divides total equally among members and leaves remainder to owner", () => {
      const result = calculateShareAmounts(10000, "equal", null, [
        { personId: "p1" },
        { personId: "p2" },
      ]);
      expect(result).toEqual([
        { personId: "p1", ratio: null, amount: 3333 },
        { personId: "p2", ratio: null, amount: 3333 },
      ]);
      expect(result.reduce((sum, share) => sum + share.amount, 0)).toBeLessThanOrEqual(10000);
    });

    it("returns one share when there is one member", () => {
      const result = calculateShareAmounts(10000, "equal", null, [{ personId: "p1" }]);
      expect(result).toEqual([{ personId: "p1", ratio: null, amount: 5000 }]);
    });
  });

  describe("ratio method", () => {
    it("distributes according to member ratios with owner keeping the remainder", () => {
      const result = calculateShareAmounts(10000, "ratio", 1, [
        { personId: "p1", ratio: 1 },
        { personId: "p2", ratio: 2 },
      ]);
      expect(result).toEqual([
        { personId: "p1", ratio: 1, amount: 2500 },
        { personId: "p2", ratio: 2, amount: 5000 },
      ]);
      expect(result.reduce((sum, share) => sum + share.amount, 0)).toBeLessThanOrEqual(10000);
    });

    it("throws when ownRatio is missing", () => {
      expect(() =>
        calculateShareAmounts(10000, "ratio", null, [{ personId: "p1", ratio: 1 }]),
      ).toThrow(BadRequestError);
    });

    it("throws when a member ratio is missing or non-positive", () => {
      expect(() =>
        calculateShareAmounts(10000, "ratio", 1, [{ personId: "p1", ratio: undefined as unknown as number }]),
      ).toThrow(BadRequestError);
      expect(() =>
        calculateShareAmounts(10000, "ratio", 1, [{ personId: "p1", ratio: 0 }]),
      ).toThrow(BadRequestError);
    });
  });

  describe("amount method", () => {
    it("uses the provided amounts when they do not exceed total", () => {
      const result = calculateShareAmounts(10000, "amount", null, [
        { personId: "p1", amount: 3000 },
        { personId: "p2", amount: 4000 },
      ]);
      expect(result).toEqual([
        { personId: "p1", ratio: null, amount: 3000 },
        { personId: "p2", ratio: null, amount: 4000 },
      ]);
    });

    it("throws when the sum of amounts exceeds the total", () => {
      expect(() =>
        calculateShareAmounts(10000, "amount", null, [
          { personId: "p1", amount: 6000 },
          { personId: "p2", amount: 5000 },
        ]),
      ).toThrow(BadRequestError);
    });

    it("throws when a share amount is less than 1", () => {
      expect(() =>
        calculateShareAmounts(10000, "amount", null, [{ personId: "p1", amount: 0 }]),
      ).toThrow(BadRequestError);
    });
  });

});
