export const CURRENCY_MINOR_UNITS = {
  JPY: 0,
  USD: 2,
  EUR: 2,
} as const;

export type SupportedCurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export const SUPPORTED_CURRENCY_CODES = Object.keys(CURRENCY_MINOR_UNITS) as SupportedCurrencyCode[];
export const DEFAULT_CURRENCY_CODE: SupportedCurrencyCode = "JPY";
export const DEFAULT_EXCHANGE_RATE_TO_JPY = 1;

export function isSupportedCurrencyCode(value: string): value is SupportedCurrencyCode {
  return value in CURRENCY_MINOR_UNITS;
}

export function getCurrencyMinorUnits(currencyCode: SupportedCurrencyCode) {
  return CURRENCY_MINOR_UNITS[currencyCode];
}

export function toMajorCurrencyUnit(amount: number, currencyCode: SupportedCurrencyCode) {
  return amount / 10 ** getCurrencyMinorUnits(currencyCode);
}

export function toMinorCurrencyUnit(amount: number, currencyCode: SupportedCurrencyCode) {
  return Math.round(amount * 10 ** getCurrencyMinorUnits(currencyCode));
}

export function convertMinorUnitToJpy(amount: number, currencyCode: SupportedCurrencyCode, exchangeRateToJpy: number) {
  return Math.round(toMajorCurrencyUnit(amount, currencyCode) * exchangeRateToJpy);
}
