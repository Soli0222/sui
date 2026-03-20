import type {
  AccountForecast,
  AccountsResponse,
  BalanceHistoryResponse,
  BillingResponse,
  CreditCardsResponse,
  DashboardResponse,
  LoansResponse,
  RecurringItemsResponse,
  TransactionsResponse,
} from "@sui/shared";
import { DEFAULT_SETTINGS } from "@sui/shared";

const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function formatCurrency(amount: number) {
  return currencyFormatter.format(amount);
}

function formatAccountForecast(item: AccountForecast) {
  const warning = item.willBeNegative ? " ⚠️ 要注意" : "";
  return `  ${item.accountName}: ${formatCurrency(item.currentBalance)} -> 最小 ${formatCurrency(item.minBalance)}（${item.minBalanceDate}）${warning}`;
}

export function formatJson(data: unknown) {
  return JSON.stringify(data, null, 2);
}

export function formatDashboardText(data: DashboardResponse, today: string) {
  const lines = [
    `合計残高: ${formatCurrency(data.totalBalance)}`,
    `予測最小残高: ${formatCurrency(data.minBalance)}`,
    "",
  ];

  if (data.nextIncome) {
    lines.push(
      `直近の収入: ${data.nextIncome.description} ${formatCurrency(data.nextIncome.amount)}（${data.nextIncome.date}）[id: ${data.nextIncome.id}]`,
    );
  }
  if (data.nextExpense) {
    lines.push(
      `直近の支出: ${data.nextExpense.description} ${formatCurrency(data.nextExpense.amount)}（${data.nextExpense.date}）[id: ${data.nextExpense.id}]`,
    );
  }

  lines.push("", "【口座別予測】");
  for (const forecast of data.accountForecasts) {
    lines.push(formatAccountForecast(forecast));
  }

  const todayEvents = data.forecast.filter((event) => event.date === today);
  if (todayEvents.length > 0) {
    lines.push("", "【本日の未確定イベント】");
    for (const event of todayEvents) {
      const typeLabel = event.type === "income" ? "収入" : "支出";
      lines.push(
        `  [${event.id}] ${typeLabel}: ${event.description} ${formatCurrency(event.amount)}`,
      );
    }
  } else {
    lines.push("", "本日の未確定イベントはありません");
  }

  lines.push(`未確定イベント総数: ${data.forecast.length}件`);

  return lines.join("\n");
}

export function formatForecastSummary(data: DashboardResponse, forecastMonths?: number) {
  const months = forecastMonths ?? Number(DEFAULT_SETTINGS.forecast_months);
  const minEvent = data.forecast.reduce<{ amount: number; date: string } | null>((current, event) => {
    if (!current || event.balance < current.amount) {
      return { amount: event.balance, date: event.date };
    }
    return current;
  }, null);

  const warnings = data.accountForecasts.filter((forecast) => forecast.willBeNegative);
  const lines = [
    "=== sui 資産予測サマリー ===",
    "",
    `■ 現在の合計残高: ${formatCurrency(data.totalBalance)}`,
    `■ 予測最小残高:   ${formatCurrency(minEvent?.amount ?? data.totalBalance)}（${minEvent?.date ?? "該当なし"}）`,
    `■ 予測期間:       ${months}ヶ月`,
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
    lines.push(`  収入: ${data.nextIncome.description} ${formatCurrency(data.nextIncome.amount)}（${data.nextIncome.date}）`);
  }
  if (data.nextExpense) {
    lines.push(`  支出: ${data.nextExpense.description} ${formatCurrency(data.nextExpense.amount)}（${data.nextExpense.date}）`);
  }
  if (!data.nextIncome && !data.nextExpense) {
    lines.push("  直近のイベントはありません");
  }

  lines.push("", "【警告】");
  if (warnings.length === 0) {
    lines.push("  特にありません");
  } else {
    for (const warning of warnings) {
      lines.push(`  ⚠️ ${warning.accountName} が ${warning.minBalanceDate.slice(0, 7)} に残高不足の可能性があります`);
    }
  }

  return lines.join("\n");
}

function summarizeList(title: string, count: number, data: unknown) {
  return `${title}: ${count}件\n\n${formatJson(data)}`;
}

export function formatAccountsText(accounts: AccountsResponse) {
  return summarizeList("口座一覧", accounts.length, accounts);
}

export function formatRecurringItemsText(items: RecurringItemsResponse) {
  return summarizeList("固定収支一覧", items.length, items);
}

export function formatCreditCardsText(cards: CreditCardsResponse) {
  return summarizeList("クレジットカード一覧", cards.length, cards);
}

export function formatLoansText(loans: LoansResponse) {
  return summarizeList("ローン一覧", loans.length, loans);
}

export function formatBillingText(billing: BillingResponse) {
  return [
    `請求月: ${billing.yearMonth}`,
    `確定請求額合計: ${formatCurrency(billing.total)}`,
    `適用請求額合計: ${formatCurrency(billing.appliedTotal)}`,
    `請求ソース: ${billing.sourceType}`,
    "",
    formatJson(billing),
  ].join("\n");
}

export function formatTransactionsText(transactions: TransactionsResponse) {
  return [
    `取引履歴: ${transactions.total}件中 ${transactions.items.length}件を表示`,
    `ページ: ${transactions.page}`,
    `件数: ${transactions.limit}`,
    "",
    formatJson(transactions),
  ].join("\n");
}

export function formatBalanceHistory(data: BalanceHistoryResponse) {
  if (data.points.length === 0) {
    return "該当期間の残高推移データがありません。";
  }

  const lines = data.points.map((point) =>
    `${point.date}: ${formatCurrency(point.balance)}  ${point.description}`,
  );
  const first = data.points[0];
  const last = data.points[data.points.length - 1];
  const diff = last.balance - first.balance;
  const sign = diff >= 0 ? "+" : "";

  return [
    `残高推移 (${first.date} 〜 ${last.date})`,
    `期間中の変動: ${sign}${formatCurrency(diff)}`,
    "",
    ...lines,
  ].join("\n");
}
