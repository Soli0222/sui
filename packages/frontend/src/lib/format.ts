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

  return `${formattedValue} / ${formatCurrency(valueJpy, "JPY")}`;
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
