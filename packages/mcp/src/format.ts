import type {
  AccountForecast,
  AccountsResponse,
  BalanceHistoryResponse,
  BillingResponse,
  CreditCardsResponse,
  DashboardResponse,
  ForecastEvent,
  LoansResponse,
  RecurringItemsResponse,
  SubscriptionsResponse,
  SupportedCurrencyCode,
  Transaction,
  TransactionsResponse,
} from "@sui/shared";
import { DEFAULT_CURRENCY_CODE, DEFAULT_SETTINGS, getCurrencyMinorUnits, toMajorCurrencyUnit, formatSchedule } from "@sui/shared";

const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const SUBSCRIPTION_FORECAST_NOTE =
  "サブスク台帳は残高予測に直接反映されません。カード払い分はクレジットカード請求額に含めて扱います。";

const MANUAL_CONFIRM_NOTE =
  "予定日超過イベントも自動確定しません。実際の金額と口座を確認してから confirm_forecast で手動確定してください。";

export function formatCurrency(amount: number | null | undefined, currencyCode?: SupportedCurrencyCode | null) {
  if (typeof amount !== "number") {
    return "未設定";
  }

  const code = currencyCode ?? "JPY";
  const major = toMajorCurrencyUnit(amount, code);

  if (code === "JPY") {
    return currencyFormatter.format(major);
  }

  const minorUnits = getCurrencyMinorUnits(code);
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: code,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(major);
}

function formatForecastEventType(type: "income" | "expense" | "transfer") {
  if (type === "income") {
    return "収入";
  }

  if (type === "expense") {
    return "支出";
  }

  return "振替";
}

function formatTransactionType(type: Transaction["type"]) {
  if (type === "adjustment") {
    return "調整";
  }

  return formatForecastEventType(type);
}

function formatEnabled(enabled: boolean) {
  return enabled ? "有効" : "無効";
}

function formatDateShiftPolicy(policy?: string | null) {
  if (policy === "previous") {
    return "前営業日";
  }
  if (policy === "next") {
    return "翌営業日";
  }
  return "調整なし";
}

export function formatRecurringSchedule(item: { recurrence?: string | null; interval?: number | null; dayOfMonth?: number | null; dayOfWeek?: number | null; startDate?: string | null }) {
  return formatSchedule({
    recurrence: item.recurrence ?? "monthly",
    interval: item.interval ?? 1,
    dayOfMonth: item.dayOfMonth ?? null,
    dayOfWeek: item.dayOfWeek ?? null,
    startDate: item.startDate ?? null,
  });
}

export function formatSubscriptionSchedule(subscription: { recurrence?: string | null; interval?: number | null; dayOfMonth?: number | null; dayOfWeek?: number | null; startDate?: string | null }) {
  return formatSchedule({
    recurrence: subscription.recurrence ?? "monthly",
    interval: subscription.interval ?? 1,
    dayOfMonth: subscription.dayOfMonth ?? null,
    dayOfWeek: subscription.dayOfWeek ?? null,
    startDate: subscription.startDate ?? null,
  });
}

function formatAccountName(
  account?: { name?: string | null } | null,
  accountId?: string | null,
) {
  return account?.name ?? accountId ?? "未設定";
}

function formatTransferSuffix(
  transferToAccount?: { name?: string | null } | null,
  transferToAccountId?: string | null,
) {
  const transferTarget = formatAccountName(transferToAccount, transferToAccountId);
  return transferTarget === "未設定" ? "" : ` -> ${transferTarget}`;
}

function formatAccountForecast(item: AccountForecast) {
  const warning = item.warningLevel === "red"
    ? " 🔴 実残高不足"
    : item.warningLevel === "yellow"
      ? " ⚠️ 可処分残高不足"
      : "";
  return `  ${item.accountName}: ${formatCurrency(item.currentBalance, item.currencyCode)} -> 最小 ${formatCurrency(item.minBalance, item.currencyCode)}（${item.minBalanceDate}）${warning}`;
}

export function formatJson(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function formatEmptyList(title: string) {
  return `${title}: 0件\n  ありません`;
}

export function formatDashboardText(data: DashboardResponse, today: string) {
  const overdueForecast = data.overdueForecast ?? [];
  const lines = [
    `合計残高: ${formatCurrency(data.totalBalance)}`,
    `予測最小残高: ${formatCurrency(data.minBalance)}`,
    `注記: ${SUBSCRIPTION_FORECAST_NOTE}`,
    `注記: ${MANUAL_CONFIRM_NOTE}`,
    "",
  ];

  if (data.nextIncome) {
    lines.push(
      `直近の収入: ${data.nextIncome.description} ${formatCurrency(data.nextIncome.amount, data.nextIncome.currencyCode)}（${data.nextIncome.date}）[id: ${data.nextIncome.id}]`,
    );
  }
  if (data.nextExpense) {
    lines.push(
      `直近の支出: ${data.nextExpense.description} ${formatCurrency(data.nextExpense.amount, data.nextExpense.currencyCode)}（${data.nextExpense.date}）[id: ${data.nextExpense.id}]`,
    );
  }

  lines.push("", "【口座別予測】");
  for (const forecast of data.accountForecasts) {
    lines.push(formatAccountForecast(forecast));
  }

  if (overdueForecast.length > 0) {
    lines.push("", "【予定日超過の未確定イベント】");
    for (const event of overdueForecast) {
      const typeLabel = formatForecastEventType(event.type);
      lines.push(
        `  [${event.id}] ${event.date} ${typeLabel}: ${event.description} ${formatCurrency(event.amount, event.currencyCode)}`,
      );
    }
  } else {
    lines.push("", "予定日超過の未確定イベントはありません");
  }

  const todayEvents = data.forecast.filter((event) => event.date === today);
  if (todayEvents.length > 0) {
    lines.push("", "【本日の未確定イベント】");
    for (const event of todayEvents) {
      const typeLabel = formatForecastEventType(event.type);
      lines.push(
        `  [${event.id}] ${typeLabel}: ${event.description} ${formatCurrency(event.amount, event.currencyCode)}`,
      );
    }
  } else {
    lines.push("", "本日の未確定イベントはありません");
  }

  lines.push(`未確定イベント総数: ${data.forecast.length}件（予定日超過 ${overdueForecast.length}件）`);

  return lines.join("\n");
}

function getAccountMinBalance(forecast: AccountForecast) {
  return forecast.events.reduce<{
    balance: number;
    balanceJpy: number;
    currencyCode: SupportedCurrencyCode | null;
    date: string;
  } | null>((current, event) => {
    if (!current || event.balance < current.balance) {
      return {
        balance: event.balance,
        balanceJpy: event.balanceJpy,
        currencyCode: event.currencyCode,
        date: event.date,
      };
    }
    return current;
  }, null);
}

export function formatForecastSummary(data: DashboardResponse, forecastMonths?: number) {
  const months = forecastMonths ?? Number(DEFAULT_SETTINGS.forecast_months);
  const minEvent = data.forecast.reduce<{ amount: number; date: string } | null>((current, event) => {
    if (!current || event.balance < current.amount) {
      return { amount: event.balance, date: event.date };
    }
    return current;
  }, null);

  const warnings = data.accountForecasts.filter((forecast) => forecast.warningLevel !== "none");
  const lines = [
    "=== sui 資産予測サマリー ===",
    "",
    `■ 現在の合計残高: ${formatCurrency(data.totalBalance)}`,
    `■ 予測最小残高:   ${formatCurrency(minEvent?.amount ?? data.totalBalance)}（${minEvent?.date ?? "該当なし"}）`,
    `■ 予測期間:       ${months}ヶ月`,
    `■ 注記:           ${SUBSCRIPTION_FORECAST_NOTE}`,
    `■ 確定方針:       ${MANUAL_CONFIRM_NOTE}`,
    "",
    "【口座別】",
  ];

  if (data.accountForecasts.length === 0) {
    lines.push("  口座はありません");
  } else {
    for (const forecast of data.accountForecasts) {
      lines.push(formatAccountForecast(forecast));
    }
  }

  lines.push("", "【直近のイベント】");
  if (data.nextIncome) {
    lines.push(`  収入: ${data.nextIncome.description} ${formatCurrency(data.nextIncome.amount, data.nextIncome.currencyCode)}（${data.nextIncome.date}）`);
  }
  if (data.nextExpense) {
    lines.push(`  支出: ${data.nextExpense.description} ${formatCurrency(data.nextExpense.amount, data.nextExpense.currencyCode)}（${data.nextExpense.date}）`);
  }
  const nextTransfer = data.forecast.find((event) => event.type === "transfer");
  if (nextTransfer) {
    lines.push(`  振替: ${nextTransfer.description} ${formatCurrency(nextTransfer.amount, nextTransfer.currencyCode)}（${nextTransfer.date}）`);
  }
  if (!data.nextIncome && !data.nextExpense && !nextTransfer) {
    lines.push("  直近のイベントはありません");
  }

  lines.push("", "【警告】");
  if (warnings.length === 0) {
    lines.push("  特にありません");
  } else {
    for (const warning of warnings) {
      const icon = warning.warningLevel === "red" ? "🔴" : "⚠️";
      const firstNegativeDate =
        warning.events.find((event) => event.balance < 0)?.date ?? warning.minBalanceDate;
      lines.push(`  ${icon} ${warning.accountName} が ${firstNegativeDate.slice(0, 7)} に残高不足の可能性があります`);
    }
  }

  return lines.join("\n");
}

export function formatForecastAnalysisText(data: DashboardResponse, forecastMonths?: number) {
  const lines = [
    formatForecastSummary(data, forecastMonths),
    "",
    "【合計残高予測イベント】",
  ];

  if (data.forecast.length === 0) {
    lines.push("  イベントはありません");
  } else {
    for (const event of data.forecast) {
      lines.push(formatForecastEventLine(event));
    }
  }

  lines.push("", "【口座別最小残高】");
  if (data.accountForecasts.length === 0) {
    lines.push("  口座はありません");
  } else {
    for (const forecast of data.accountForecasts) {
      const minEvent = getAccountMinBalance(forecast);
      const minBalance = minEvent?.balance ?? forecast.minBalance;
      const minDate = minEvent?.date ?? forecast.minBalanceDate;
      const currencyCode = minEvent?.currencyCode ?? forecast.currencyCode;
      const warning = forecast.warningLevel === "red"
        ? " / 警告: 実残高不足"
        : forecast.warningLevel === "yellow"
          ? " / 警告: 可処分残高不足"
          : "";
      lines.push(
        `  ${forecast.accountName}: 現在 ${formatCurrency(forecast.currentBalance, forecast.currencyCode)} / 最小 ${formatCurrency(minBalance, currencyCode)}（${minDate}）${warning}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatForecastEventLine(event: ForecastEvent) {
  const typeLabel = formatForecastEventType(event.type);
  return `  ${event.date} ${typeLabel} ${event.description} ${formatCurrency(event.amount, event.currencyCode)} 残高 ${formatCurrency(event.balance, event.currencyCode)}`;
}

export function formatAccountsText(accounts: AccountsResponse) {
  if (accounts.length === 0) {
    return formatEmptyList("口座一覧");
  }

  return [
    `口座一覧: ${accounts.length}件`,
    ...accounts.map((account) =>
      `  ${account.name}: 残高 ${formatCurrency(account.balance, account.currencyCode)} / オフセット ${formatCurrency(account.balanceOffset, account.currencyCode)} / 並び順 ${account.sortOrder}`
    ),
  ].join("\n");
}

export function getRecurringCurrencyCode(item: RecurringItemsResponse[number]): SupportedCurrencyCode {
  if (item.type === "transfer") {
    return item.account?.currencyCode ?? item.transferToAccount?.currencyCode ?? DEFAULT_CURRENCY_CODE;
  }

  return item.account?.currencyCode ?? DEFAULT_CURRENCY_CODE;
}

export function formatRecurringItemAmount(item: RecurringItemsResponse[number]) {
  return formatCurrency(item.amount, getRecurringCurrencyCode(item));
}

export function formatRecurringItemsText(items: RecurringItemsResponse) {
  if (items.length === 0) {
    return formatEmptyList("固定収支一覧");
  }

  return [
    `固定収支一覧: ${items.length}件`,
    ...items.map((item) => {
      const transfer = item.type === "transfer"
        ? formatTransferSuffix(item.transferToAccount, item.transferToAccountId)
        : "";
      return `  ${item.name}: ${formatForecastEventType(item.type)} ${formatRecurringItemAmount(item)} / ${formatRecurringSchedule(item)} / ${formatEnabled(item.enabled)} / 口座 ${formatAccountName(item.account, item.accountId)}${transfer} / 期間 ${item.startDate ?? "指定なし"}〜${item.endDate ?? "継続"} / 日付調整 ${formatDateShiftPolicy(item.dateShiftPolicy)}`;
    }),
  ].join("\n");
}

export function formatCreditCardsText(cards: CreditCardsResponse) {
  if (cards.length === 0) {
    return formatEmptyList("クレジットカード一覧");
  }

  return [
    `クレジットカード一覧: ${cards.length}件`,
    ...cards.map((card) =>
      `  ${card.name}: 引落日 ${card.settlementDay ?? "未設定"} / 仮定請求額 ${formatCurrency(card.assumptionAmount, card.account?.currencyCode)} / 引落口座 ${formatAccountName(card.account, card.accountId)} / 日付調整 ${formatDateShiftPolicy(card.dateShiftPolicy)}`
    ),
  ].join("\n");
}

export function formatSubscriptionsText(subscriptions: SubscriptionsResponse) {
  if (subscriptions.length === 0) {
    return [
      formatEmptyList("サブスク一覧"),
      `注記: ${SUBSCRIPTION_FORECAST_NOTE}`,
    ].join("\n");
  }

  return [
    `サブスク一覧: ${subscriptions.length}件`,
    `注記: ${SUBSCRIPTION_FORECAST_NOTE}`,
    "",
    ...subscriptions.map((subscription) =>
      `  ${subscription.name}: ${formatCurrency(subscription.amount)} / ${formatSubscriptionSchedule(subscription)} / 開始 ${subscription.startDate} / 終了 ${subscription.endDate ?? "なし"} / 支払元 ${subscription.paymentSource ?? "未設定"}`
    ),
  ].join("\n");
}

export function formatLoansText(loans: LoansResponse) {
  if (loans.length === 0) {
    return formatEmptyList("ローン一覧");
  }

  return [
    `ローン一覧: ${loans.length}件`,
    ...loans.map((loan) =>
      `  ${loan.name}: 総額 ${formatCurrency(loan.totalAmount, loan.account?.currencyCode)} / 残高 ${formatCurrency(loan.remainingBalance, loan.account?.currencyCode)} / 次回 ${formatCurrency(loan.nextPaymentAmount, loan.account?.currencyCode)} / 残 ${loan.remainingPayments}/${loan.paymentCount}回 / 開始 ${loan.startDate} / 支払 ${loan.paymentMethod} / 口座 ${formatAccountName(loan.account, loan.accountId)} / 日付調整 ${formatDateShiftPolicy(loan.dateShiftPolicy)}`
    ),
  ].join("\n");
}

export function formatBillingText(billing: BillingResponse) {
  const lines = [
    `請求月: ${billing.yearMonth}`,
    `確定請求額合計: ${formatCurrency(billing.total)}`,
    `適用請求額合計: ${formatCurrency(billing.appliedTotal)}`,
    `請求ソース: ${billing.sourceType}`,
    `引落予定日: ${billing.resolvedSettlementDate ?? billing.settlementDate ?? "未設定"}`,
    `セーフティバルブ: ${billing.safetyValveActive ? "有効" : "無効"}`,
    "",
    "【請求明細】",
  ];

  if (billing.items.length === 0) {
    lines.push("  明細はありません");
  } else {
    for (const item of billing.items) {
      lines.push(`  カード ${item.creditCardId}: ${formatCurrency(item.amount)}`);
    }
  }

  return lines.join("\n");
}

export function formatTransactionsText(transactions: TransactionsResponse) {
  const omittedCount = Math.max(transactions.total - transactions.items.length, 0);
  const lines = [
    `取引履歴: 全${transactions.total}件中 ${transactions.items.length}件を表示（ページ ${transactions.page}, 件数 ${transactions.limit}）`,
  ];

  if (transactions.items.length === 0) {
    lines.push("  ありません");
  } else {
    for (const transaction of transactions.items) {
      lines.push(formatTransactionLine(transaction));
    }
  }

  if (omittedCount > 0) {
    lines.push(`他 ${omittedCount} 件省略`);
  }

  return lines.join("\n");
}

export function formatTransactionLine(transaction: Transaction) {
  const transfer = transaction.type === "transfer"
    ? formatTransferSuffix(
      transaction.transferToAccountName ? { name: transaction.transferToAccountName } : null,
      transaction.transferToAccountId,
    )
    : "";
  return `  ${transaction.date} ${formatTransactionType(transaction.type)} ${transaction.description} ${formatCurrency(transaction.amount, transaction.currencyCode)} / 口座 ${formatAccountName(transaction.accountName ? { name: transaction.accountName } : null, transaction.accountId)}${transfer}`;
}

export function formatBalanceHistory(data: BalanceHistoryResponse) {
  if (data.points.length === 0) {
    return "該当期間の残高推移データがありません。";
  }

  const lines = data.points.map((point) =>
    `${point.date}: ${formatCurrency(point.balance, point.currencyCode)}  ${point.description}`,
  );
  const first = data.points[0];
  const last = data.points[data.points.length - 1];
  const diff = last.balance - first.balance;
  const sign = diff >= 0 ? "+" : "";

  return [
    `残高推移 (${first.date} 〜 ${last.date})`,
    `期間中の変動: ${sign}${formatCurrency(diff, last.currencyCode)}`,
    "",
    ...lines,
  ].join("\n");
}
