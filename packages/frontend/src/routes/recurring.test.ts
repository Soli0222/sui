import { describe, expect, it } from "vitest";
import { formatCurrency } from "../lib/format";
import { getRecurringFormCurrencyCode, getRecurringItemCurrencyCode } from "./recurring";

const accounts = [
  {
    id: "jpy-account",
    name: "JPY Main",
    balance: 100000,
    balanceOffset: 0,
    lastReconciledAt: null,
    currencyCode: "JPY" as const,
    exchangeRateToJpy: 1,
    exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
    sortOrder: 0,
    deletedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "usd-account",
    name: "USD Wallet",
    balance: 100000,
    balanceOffset: 0,
    lastReconciledAt: null,
    currencyCode: "USD" as const,
    exchangeRateToJpy: 150,
    exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
    sortOrder: 1,
    deletedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "eur-account",
    name: "EUR Wallet",
    balance: 50000,
    balanceOffset: 0,
    lastReconciledAt: null,
    currencyCode: "EUR" as const,
    exchangeRateToJpy: 160,
    exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
    sortOrder: 2,
    deletedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

function accountStub(overrides: Partial<(typeof accounts)[number]>) {
  const base = accounts.find((a) => a.id === overrides.id) ?? accounts[0];
  return { ...base, ...overrides };
}

function recurringItemStub(overrides: Partial<{
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  account: typeof accounts[number] | null;
  transferToAccount: typeof accounts[number] | null;
}>) {
  return {
    id: "recurring-1",
    name: "Recurring",
    type: "expense" as const,
    amount: 1000,
    recurrence: "monthly" as const,
    dayOfMonth: 1,
    dayOfWeek: null,
    startDate: null,
    endDate: null,
    dateShiftPolicy: "none" as const,
    enabled: true,
    sortOrder: 0,
    deletedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    accountId: overrides.account?.id ?? null,
    account: overrides.account ?? null,
    transferToAccountId: overrides.transferToAccount?.id ?? null,
    transferToAccount: overrides.transferToAccount ?? null,
    ...overrides,
  };
}

describe("getRecurringItemCurrencyCode", () => {
  it("通常収支は account の通貨を使う", () => {
    const item = recurringItemStub({ type: "expense", account: accountStub({ id: "usd-account" }) });
    expect(getRecurringItemCurrencyCode(item)).toBe("USD");
  });

  it("振替は送金元口座の通貨を優先する", () => {
    const item = recurringItemStub({
      type: "transfer",
      account: accountStub({ id: "usd-account" }),
      transferToAccount: accountStub({ id: "eur-account" }),
    });
    expect(getRecurringItemCurrencyCode(item)).toBe("USD");
  });

  it("送金元のみの振替は送金元口座の通貨", () => {
    const item = recurringItemStub({
      type: "transfer",
      account: accountStub({ id: "usd-account" }),
      transferToAccount: null,
    });
    expect(getRecurringItemCurrencyCode(item)).toBe("USD");
  });

  it("送金先のみの振替は振替先口座の通貨", () => {
    const item = recurringItemStub({
      type: "transfer",
      account: null,
      transferToAccount: accountStub({ id: "eur-account" }),
    });
    expect(getRecurringItemCurrencyCode(item)).toBe("EUR");
  });

  it("口座なしのデータは JPY fallback", () => {
    const item = recurringItemStub({ type: "expense", account: null });
    expect(getRecurringItemCurrencyCode(item)).toBe("JPY");
  });
});

describe("getRecurringFormCurrencyCode", () => {
  it("通常収支は選択 accountId の通貨", () => {
    const form = { type: "expense" as const, accountId: "usd-account", transferToAccountId: "" };
    expect(getRecurringFormCurrencyCode(form, accounts)).toBe("USD");
  });

  it("振替は送金元口座の通貨を優先する", () => {
    const form = { type: "transfer" as const, accountId: "usd-account", transferToAccountId: "eur-account" };
    expect(getRecurringFormCurrencyCode(form, accounts)).toBe("USD");
  });

  it("送金元なしの振替は振替先口座の通貨", () => {
    const form = { type: "transfer" as const, accountId: "", transferToAccountId: "eur-account" };
    expect(getRecurringFormCurrencyCode(form, accounts)).toBe("EUR");
  });

  it("両方なしの初期状態は JPY fallback", () => {
    const form = { type: "transfer" as const, accountId: "", transferToAccountId: "" };
    expect(getRecurringFormCurrencyCode(form, accounts)).toBe("JPY");
  });
});

describe("固定収支一覧の金額表示", () => {
  it("USD 通常固定収支は $ 表示", () => {
    const item = recurringItemStub({
      type: "expense",
      amount: 100000,
      account: accountStub({ id: "usd-account" }),
    });
    expect(formatCurrency(item.amount, getRecurringItemCurrencyCode(item))).toBe("$1,000.00");
  });

  it("JPY 通常固定収支は ¥ 表示", () => {
    const item = recurringItemStub({
      type: "income",
      amount: 100000,
      account: accountStub({ id: "jpy-account" }),
    });
    expect(formatCurrency(item.amount, getRecurringItemCurrencyCode(item))).toMatch(/[¥￥]100,000/);
  });
});
