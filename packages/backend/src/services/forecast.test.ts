import { describe, expect, it } from "vitest";
import { applyEvent, sortEvents } from "./forecast";

describe("sortEvents", () => {
  it("sorts by date, income, transfer, expense, source priority, sort order, and description", () => {
    const sorted = sortEvents([
      {
        id: "late-date",
        date: "2026-03-20",
        type: "income",
        source: "recurring",
        isAssumption: false,
        description: "Zeta",
        amount: 10,
        accountId: "account-1",
        sourcePriority: 10,
        sortOrder: 0,
      },
      {
        id: "description-a",
        date: "2026-03-14",
        type: "expense",
        source: "recurring",
        isAssumption: false,
        description: "Alpha",
        amount: 10,
        accountId: "account-1",
        sourcePriority: 20,
        sortOrder: 2,
      },
      {
        id: "sort-order",
        date: "2026-03-14",
        type: "expense",
        source: "recurring",
        isAssumption: false,
        description: "Zulu",
        amount: 10,
        accountId: "account-1",
        sourcePriority: 20,
        sortOrder: 1,
      },
      {
        id: "source-priority",
        date: "2026-03-14",
        type: "expense",
        source: "recurring",
        isAssumption: false,
        description: "Beta",
        amount: 10,
        accountId: "account-1",
        sourcePriority: 10,
        sortOrder: 9,
      },
      {
        id: "transfer-before-expense",
        date: "2026-03-14",
        type: "transfer",
        source: "transfer",
        isAssumption: false,
        description: "Move",
        amount: 10,
        accountId: "account-1",
        transferToAccountId: "account-2",
        sourcePriority: 99,
        sortOrder: 99,
      },
      {
        id: "income-first",
        date: "2026-03-14",
        type: "income",
        source: "recurring",
        isAssumption: false,
        description: "Salary",
        amount: 10,
        accountId: "account-1",
        sourcePriority: 50,
        sortOrder: 50,
      },
    ]);

    expect(sorted.map((event) => event.id)).toEqual([
      "income-first",
      "transfer-before-expense",
      "source-priority",
      "sort-order",
      "description-a",
      "late-date",
    ]);
  });
});

describe("applyEvent", () => {
  it("adds income, subtracts expense, and keeps transfer neutral", () => {
    expect(applyEvent(1000, { type: "income", amount: 300 })).toBe(1300);
    expect(applyEvent(1000, { type: "expense", amount: 300 })).toBe(700);
    expect(applyEvent(1000, { type: "transfer", amount: 300 })).toBe(1000);
  });
});
