import type { Account, DashboardExplainResponse, ForecastEvent } from "@sui/shared";
import { formatCurrency } from "../../lib/format";

export function isTransferEvent(event: ForecastEvent | null | undefined) {
  return event?.type === "transfer";
}

export function getForecastTypeLabel(type: ForecastEvent["type"]) {
  if (type === "income") {
    return "収入";
  }

  if (type === "expense") {
    return "支出";
  }

  return "振替";
}

export function getForecastTypeClassName(type: ForecastEvent["type"]) {
  // 種別色は残高の重大度色（positive/warning/critical）と衝突させない。
  // 色は状態（安全/警告/危険）にのみ使い、種別はグレースケールの階調で区別する。
  if (type === "income") {
    return "text-ink";
  }

  if (type === "expense") {
    return "text-ink-2";
  }

  return "text-ink-3";
}

export function getForecastSourceLabel(source: ForecastEvent["source"]) {
  if (source === "recurring") {
    return "予定収支";
  }

  if (source === "credit-card") {
    return "クレジットカード";
  }

  if (source === "loan") {
    return "ローン";
  }

  return "振替";
}

export function formatSignedCurrency(value: number) {
  if (value > 0) {
    return `+${formatCurrency(value)}`;
  }

  if (value < 0) {
    return `-${formatCurrency(Math.abs(value))}`;
  }

  return formatCurrency(0);
}

export function getExplainSourceTotals(sourceTotals: DashboardExplainResponse["sourceTotals"]) {
  return [
    { label: "固定収入", value: sourceTotals.recurringIncomeJpy },
    { label: "固定支出", value: sourceTotals.recurringExpenseJpy },
    { label: "クレジットカード", value: sourceTotals.creditCardJpy },
    { label: "ローン", value: sourceTotals.loanJpy },
    { label: "振替", value: sourceTotals.transferJpy },
  ];
}

export function getAccountName(accounts: Account[], accountId: string | null | undefined) {
  return accountId ? accounts.find((account) => account.id === accountId)?.name ?? "未設定" : "-";
}

export function formatForecastAccounts(event: ForecastEvent, accounts: Account[]) {
  if (event.type === "transfer") {
    return `${getAccountName(accounts, event.accountId)} → ${getAccountName(accounts, event.transferToAccountId)}`;
  }

  return getAccountName(accounts, event.accountId);
}

export function StateMessage({ message, tone = "default" }: { message: string; tone?: "default" | "danger" }) {
  return <div className={tone === "danger" ? "text-critical" : "text-ink-2"}>{message}</div>;
}
