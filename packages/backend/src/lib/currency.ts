import {
  DEFAULT_CURRENCY_CODE,
  DEFAULT_EXCHANGE_RATE_TO_JPY,
  convertMinorUnitToJpy,
  isSupportedCurrencyCode,
  type SupportedCurrencyCode,
} from "@sui/shared";
import { z } from "zod";

export type CurrencyLike = {
  currencyCode: string;
  exchangeRateToJpy: number;
};

export const currencyCodeSchema = z.enum(["JPY", "USD", "EUR"]);

export function normalizeCurrencyCode(value: string | null | undefined): SupportedCurrencyCode {
  if (!value) {
    return DEFAULT_CURRENCY_CODE;
  }

  const upperValue = value.toUpperCase();
  return isSupportedCurrencyCode(upperValue) ? upperValue : DEFAULT_CURRENCY_CODE;
}

export function normalizeExchangeRateToJpy(currencyCode: SupportedCurrencyCode, value: number | null | undefined) {
  if (currencyCode === DEFAULT_CURRENCY_CODE) {
    return DEFAULT_EXCHANGE_RATE_TO_JPY;
  }

  return value ?? DEFAULT_EXCHANGE_RATE_TO_JPY;
}

export function toJpy(amount: number, account: CurrencyLike) {
  const currencyCode = normalizeCurrencyCode(account.currencyCode);
  return convertMinorUnitToJpy(amount, currencyCode, account.exchangeRateToJpy);
}

export function formatCurrencyFields<T extends CurrencyLike>(value: T) {
  return {
    ...value,
    currencyCode: normalizeCurrencyCode(value.currencyCode),
  };
}
