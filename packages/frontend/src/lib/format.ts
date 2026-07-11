import {
  DEFAULT_CURRENCY_CODE,
  convertMinorUnitToJpy,
  getCurrencyMinorUnits,
  toMajorCurrencyUnit,
  toMinorCurrencyUnit,
  type SupportedCurrencyCode,
} from "@sui/shared";

const JAPAN_TIME_ZONE = "Asia/Tokyo";

export function formatCurrency(value: number, currencyCode: SupportedCurrencyCode = DEFAULT_CURRENCY_CODE) {
  const minorUnits = getCurrencyMinorUnits(currencyCode);

  return new Intl.NumberFormat(currencyCode === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(toMajorCurrencyUnit(value, currencyCode));
}

export function formatCurrencyWithJpy(
  value: number,
  currencyCode: SupportedCurrencyCode,
  valueJpy: number,
) {
  const formattedValue = formatCurrency(value, currencyCode);
  if (currencyCode === "JPY") {
    return formattedValue;
  }

  return `${formattedValue}（${formatCurrency(valueJpy, "JPY")}）`;
}

/**
 * テーブルの金額セル用。主金額と JPY 換算額を分けて返し、呼び出し側で
 * 主金額の下に小さく換算額を置く 2 行組として描画する（スラッシュ連結の廃止）。
 */
export function formatCurrencyParts(
  value: number,
  currencyCode: SupportedCurrencyCode,
  valueJpy: number,
): { primary: string; secondary: string | null } {
  if (currencyCode === "JPY") {
    return { primary: formatCurrency(value, currencyCode), secondary: null };
  }

  return {
    primary: formatCurrency(value, currencyCode),
    secondary: formatCurrency(valueJpy, "JPY"),
  };
}

/** 符号規約（B-7）で使う取引種別。調整は元データが符号付き、それ以外は常に正の絶対値で渡される。 */
export type SignableTransactionType = "income" | "expense" | "transfer" | "adjustment";

function resolveSignedAmount(type: SignableTransactionType, amount: number): number {
  if (type === "expense") {
    return -amount;
  }

  // income は常に正、adjustment は元々符号付き、transfer は符号を付けない（呼び出し側で無視する）。
  return amount;
}

/** 正なら「+」、負なら「-」、ゼロなら符号なしで整形する。 */
export function formatSignedCurrency(value: number, currencyCode: SupportedCurrencyCode = DEFAULT_CURRENCY_CODE) {
  if (value > 0) {
    return `+${formatCurrency(value, currencyCode)}`;
  }

  if (value < 0) {
    return `-${formatCurrency(Math.abs(value), currencyCode)}`;
  }

  return formatCurrency(0, currencyCode);
}

/**
 * 符号規約（B-7）: 収入は+、支出は-、色は状態にのみ使う。振替は符号を付けない。
 * 調整取引だけに「+」が付いていた現状をやめ、収入・支出にも同じ規約を適用する。
 */
export function formatTypedAmount(
  type: SignableTransactionType,
  amount: number,
  currencyCode: SupportedCurrencyCode = DEFAULT_CURRENCY_CODE,
) {
  if (type === "transfer") {
    return formatCurrency(amount, currencyCode);
  }

  return formatSignedCurrency(resolveSignedAmount(type, amount), currencyCode);
}

/**
 * ResponsiveTable の金額セル用。主金額（符号付き）と JPY 換算額（符号付き）を分けて返す。
 */
export function formatTypedAmountParts(
  type: SignableTransactionType,
  amount: number,
  currencyCode: SupportedCurrencyCode,
  amountJpy: number,
): { primary: string; secondary: string | null } {
  const primary = formatTypedAmount(type, amount, currencyCode);

  if (currencyCode === "JPY") {
    return { primary, secondary: null };
  }

  const secondary =
    type === "transfer"
      ? formatCurrency(amountJpy, "JPY")
      : formatSignedCurrency(resolveSignedAmount(type, amountJpy), "JPY");

  return { primary, secondary };
}

export function formatCurrencyInputValue(value: number, currencyCode: SupportedCurrencyCode) {
  const minorUnits = getCurrencyMinorUnits(currencyCode);
  if (minorUnits === 0) {
    return String(value);
  }

  return toMajorCurrencyUnit(value, currencyCode).toFixed(minorUnits);
}

export function parseCurrencyInputValue(value: string, currencyCode: SupportedCurrencyCode) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return toMinorCurrencyUnit(numericValue, currencyCode);
}

export function convertCurrencyInputToJpy(
  value: number,
  currencyCode: SupportedCurrencyCode,
  exchangeRateToJpy: number,
) {
  return convertMinorUnitToJpy(value, currencyCode, exchangeRateToJpy);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

export function formatDayOfWeek(dayOfWeek: number | null) {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  if (dayOfWeek === null || dayOfWeek === undefined) {
    return "";
  }
  return days[dayOfWeek] ?? "";
}

export function formatDateWithYear(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

/**
 * Y 軸ラベル用の万単位短縮表記（「120万」「-5万」「¥0」）。Mono で組む前提。
 */
export function formatManUnit(value: number) {
  if (value === 0) {
    return "¥0";
  }

  const manValue = value / 10_000;
  const rounded = Math.round(manValue * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);

  return `${formatted}万`;
}

export function formatChartDateWithYear(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}/${month}/${day}`;
}
