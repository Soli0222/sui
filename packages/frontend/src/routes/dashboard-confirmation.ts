import { INT4_MAX, type ForecastEvent, type SupportedCurrencyCode } from "@sui/shared";
import { formatCurrencyInputValue } from "../lib/format";
import { readMoneyDraft } from "../components/ui/money-input";

export type ConfirmationDraft = {
  selected: boolean;
  amountRaw: string;
  accountId: string;
  fingerprint: string;
  error?: string;
};

export function eventFingerprint(event: ForecastEvent) {
  return `${event.date}|${event.amount}|${event.currencyCode}|${event.accountId ?? ""}|${event.transferToAccountId ?? ""}`;
}

export function createConfirmationDraft(event: ForecastEvent, accountId: string): ConfirmationDraft {
  return { selected: true, amountRaw: formatCurrencyInputValue(event.amount, event.currencyCode), accountId,
    fingerprint: eventFingerprint(event) };
}

export function confirmationAmount(raw: string, currencyCode: SupportedCurrencyCode): number | null {
  const parsed = readMoneyDraft(raw, currencyCode);
  return parsed.kind === "valid" && parsed.minorUnits !== null && parsed.minorUnits >= 0 && parsed.minorUnits <= INT4_MAX
    ? parsed.minorUnits : null;
}

export function isConfirmationStale(draft: ConfirmationDraft, event: ForecastEvent) {
  return draft.fingerprint !== eventFingerprint(event);
}
