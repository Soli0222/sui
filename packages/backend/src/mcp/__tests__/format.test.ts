import type {
  AccountsResponse,
  BillingResponse,
  CreditCardsResponse,
  DashboardResponse,
  LoansResponse,
  RecurringItemsResponse,
  SubscriptionsResponse,
  TransactionsResponse,
} from "@sui/shared";
import {
  formatAccountsText,
  formatBillingText,
  formatCreditCardsText,
  formatForecastAnalysisText,
  formatLoansText,
  formatRecurringItemsText,
  formatSubscriptionsText,
  formatTransactionsText,
  getRecurringCurrencyCode,
} from "../format";
import { describe, expect, it } from "vitest";

const rawJsonKeyPattern = /"[^"\n]+":/;

describe("formatters", () => {
  it("formats transactions as compact one-line entries with omitted counts", () => {
    const transactions: TransactionsResponse = {
      items: [
        {
          id: "tx-1",
          accountId: "account-1",
          transferToAccountId: null,
          forecastEventId: null,
          date: "2026-03-01",
          type: "expense",
          description: "スーパー",
          amount: 5200,
          amountJpy: 5200,
          createdAt: "2026-03-01T00:00:00.000Z",
          currencyCode: "JPY",
          accountName: "Main",
        },
        {
          id: "tx-2",
          accountId: "account-1",
          transferToAccountId: "account-2",
          forecastEventId: null,
          date: "2026-03-02",
          type: "transfer",
          description: "貯蓄移動",
          amount: 30000,
          amountJpy: 30000,
          createdAt: "2026-03-02T00:00:00.000Z",
          currencyCode: "JPY",
          accountName: "Main",
          transferToAccountName: "Savings",
          transferToAccountCurrencyCode: "JPY",
        },
      ],
      page: 1,
      limit: 100,
      total: 4,
    };

    const text = formatTransactionsText(transactions);

    expect(text).toContain("取引履歴: 全4件中 2件を表示");
    expect(text).toContain("2026-03-01 支出 スーパー ￥5,200 / 口座 Main");
    expect(text).toContain("2026-03-02 振替 貯蓄移動 ￥30,000 / 口座 Main -> Savings");
    expect(text).toContain("他 2 件省略");
    expect(text).not.toMatch(rawJsonKeyPattern);
  });

  it("formats forecast analysis from aggregate events without account-event duplicates", () => {
    const dashboard: DashboardResponse = {
      totalBalance: 123456,
      minBalance: 34567,
      nextIncome: {
        id: "income-1",
        date: "2026-03-25",
        description: "給与",
        amount: 250000,
        amountJpy: 250000,
        currencyCode: "JPY",
      },
      nextExpense: null,
      overdueForecast: [],
      forecast: [
        {
          id: "event-1",
          date: "2026-03-25",
          type: "income",
          source: "recurring",
          isAssumption: false,
          description: "給与",
          amount: 250000,
          amountJpy: 250000,
          balance: 373456,
          balanceJpy: 373456,
          currencyCode: "JPY",
          accountId: "account-1",
        },
      ],
      accountForecasts: [
        {
          accountId: "account-1",
          accountName: "三菱UFJ銀行",
          currentBalance: 123456,
          currentBalanceJpy: 123456,
          currencyCode: "JPY",
          exchangeRateToJpy: 1,
          events: [
            {
              id: "account-event-1",
              date: "2026-03-27",
              type: "expense",
              source: "recurring",
              isAssumption: false,
              description: "口座別だけの重複イベント",
              amount: 130000,
              amountJpy: 130000,
              balance: -1000,
              balanceJpy: -1000,
              currencyCode: "JPY",
              accountId: "account-1",
            },
          ],
          minBalance: 34567,
          minBalanceJpy: 34567,
          minBalanceDate: "2026-03-25",
          warningLevel: "red",
        },
      ],
    };

    const text = formatForecastAnalysisText(dashboard, 6);

    expect(text).toContain("2026-03-25 収入 給与 ￥250,000 残高 ￥373,456");
    expect(text).toContain("三菱UFJ銀行: 現在 ￥123,456 / 最小");
    expect(text).toContain("2026-03-27");
    expect(text).not.toContain("口座別だけの重複イベント");
    expect(text).not.toMatch(rawJsonKeyPattern);
  });

  it("formats weekly recurring and subscription schedules", () => {
    const weeklyRecurring = {
      id: "recurring-2",
      name: "ランチ",
      type: "expense",
      amount: 1000,
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      startDate: null,
      endDate: null,
      dateShiftPolicy: "none",
      accountId: "account-1",
      account: {
        id: "account-1",
        name: "Main",
        balance: 123456,
        balanceOffset: 1000,
        lastReconciledAt: null,
        currencyCode: "JPY",
        exchangeRateToJpy: 1,
        exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
        sortOrder: 1,
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      transferToAccountId: null,
      transferToAccount: null,
      enabled: true,
      sortOrder: 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;
    const weeklySubscription = {
      id: "subscription-2",
      name: "Music",
      amount: 980,
      currencyCode: "JPY" as const,
      exchangeRateToJpy: 1,
      exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
      recurrence: "weekly",
      interval: 1,
      startDate: "2026-01-01",
      dayOfMonth: null,
      dayOfWeek: 0,
      endDate: null,
      paymentSource: null,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;

    const recurringText = formatRecurringItemsText([weeklyRecurring] as RecurringItemsResponse);
    const subscriptionText = formatSubscriptionsText([weeklySubscription] as SubscriptionsResponse);

    expect(recurringText).toContain("毎週 金曜日");
    expect(subscriptionText).toContain("毎週 日曜日");
    expect(recurringText).not.toMatch(rawJsonKeyPattern);
    expect(subscriptionText).not.toMatch(rawJsonKeyPattern);
  });

  it("formats subscriptions in the subscription currency with a JPY total", () => {
    const usdSubscription = {
      id: "subscription-usd",
      name: "Cloud",
      amount: 1099,
      currencyCode: "USD" as const,
      exchangeRateToJpy: 150,
      exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
      recurrence: "monthly",
      interval: 1,
      startDate: "2026-01-01",
      dayOfMonth: 10,
      dayOfWeek: null,
      endDate: null,
      paymentSource: null,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;
    const jpySubscription = {
      id: "subscription-jpy",
      name: "Music",
      amount: 980,
      currencyCode: "JPY" as const,
      exchangeRateToJpy: 1,
      exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
      recurrence: "monthly",
      interval: 1,
      startDate: "2026-01-01",
      dayOfMonth: 10,
      dayOfWeek: null,
      endDate: null,
      paymentSource: null,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;

    const text = formatSubscriptionsText([usdSubscription, jpySubscription] as SubscriptionsResponse);

    expect(text).toContain("$10.99");
    expect(text).toContain("￥980");
    expect(text).toContain("サブスク台帳合計: ￥2,629");
    expect(text).not.toMatch(rawJsonKeyPattern);
  });

  it("formats recurring items in the currency of the source or destination account", () => {
    const usdAccount = {
      id: "account-usd",
      name: "USD Wallet",
      balance: 12345,
      balanceOffset: 0,
      lastReconciledAt: null,
      currencyCode: "USD" as const,
      exchangeRateToJpy: 150,
      exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
      sortOrder: 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const usdSourceOnly = {
      id: "recurring-usd-out",
      name: "USD External Out",
      type: "transfer",
      amount: 123456,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      dateShiftPolicy: "none",
      accountId: usdAccount.id,
      account: usdAccount,
      transferToAccountId: null,
      transferToAccount: null,
      enabled: true,
      sortOrder: 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;
    const usdDestinationOnly = {
      id: "recurring-usd-in",
      name: "USD External In",
      type: "transfer",
      amount: 123456,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      dateShiftPolicy: "none",
      accountId: null,
      account: null,
      transferToAccountId: usdAccount.id,
      transferToAccount: usdAccount,
      enabled: true,
      sortOrder: 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;

    const sourceText = formatRecurringItemsText([usdSourceOnly] as RecurringItemsResponse);
    const destinationText = formatRecurringItemsText([usdDestinationOnly] as RecurringItemsResponse);

    expect(sourceText).toContain("$1,234.56");
    expect(destinationText).toContain("$1,234.56");
    expect(getRecurringCurrencyCode(usdSourceOnly as RecurringItemsResponse[number])).toBe("USD");
    expect(getRecurringCurrencyCode(usdDestinationOnly as RecurringItemsResponse[number])).toBe("USD");
    expect(sourceText).not.toMatch(rawJsonKeyPattern);
    expect(destinationText).not.toMatch(rawJsonKeyPattern);
  });

  it("formats list-style API responses without raw JSON", () => {
    const account = {
      id: "account-1",
      name: "Main",
      balance: 123456,
      balanceOffset: 1000,
      lastReconciledAt: null,
      currencyCode: "JPY",
      exchangeRateToJpy: 1,
      exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
      sortOrder: 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    } as const;
    const sections = [
      formatAccountsText([account] as AccountsResponse),
      formatRecurringItemsText([
        {
          id: "recurring-1",
          name: "家賃",
          type: "expense",
          amount: 80000,
          dayOfMonth: 27,
          startDate: null,
          endDate: null,
          dateShiftPolicy: "previous",
          accountId: "account-1",
          account,
          transferToAccountId: null,
          transferToAccount: null,
          enabled: true,
          sortOrder: 1,
          deletedAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ] as RecurringItemsResponse),
      formatCreditCardsText([
        {
          id: "card-1",
          name: "Visa",
          settlementDay: 27,
          accountId: "account-1",
          account,
          assumptionAmount: 50000,
          dateShiftPolicy: "next",
          sortOrder: 1,
          deletedAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ] as CreditCardsResponse),
      formatSubscriptionsText([
        {
          id: "subscription-1",
          name: "Music",
          amount: 980,
          currencyCode: "JPY" as const,
          exchangeRateToJpy: 1,
          exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
          recurrence: "monthly",
          interval: 1,
          startDate: "2026-01-01",
          dayOfMonth: 10,
          endDate: null,
          paymentSource: "Visa",
          deletedAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ] as SubscriptionsResponse),
      formatLoansText([
        {
          id: "loan-1",
          name: "PCローン",
          totalAmount: 240000,
          startDate: "2026-04-30",
          paymentCount: 12,
          dateShiftPolicy: "previous",
          paymentMethod: "account_withdrawal",
          accountId: "account-1",
          account,
          remainingBalance: 180000,
          remainingPayments: 9,
          nextPaymentAmount: 20000,
          deletedAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ] as LoansResponse),
      formatBillingText({
        yearMonth: "2026-03",
        settlementDate: "2026-03-27",
        resolvedSettlementDate: "2026-03-27",
        items: [{ creditCardId: "card-1", amount: 50000 }],
        total: 50000,
        appliedTotal: 50000,
        safetyValveActive: false,
        sourceType: "actual",
        monthOffset: 0,
      } as BillingResponse),
    ];

    const text = sections.join("\n\n");

    expect(text).toContain("家賃: 支出 ￥80,000");
    expect(text).toContain("Visa: 引落日 27");
    expect(text).toContain("Music: ￥980");
    expect(text).toContain("PCローン: 総額 ￥240,000");
    expect(text).toContain("カード card-1: ￥50,000");
    expect(text).not.toMatch(rawJsonKeyPattern);
  });
});
