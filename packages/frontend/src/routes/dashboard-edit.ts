import { INT4_MAX, type ForecastEvent, type SupportedCurrencyCode } from "@sui/shared";
import { formatCurrencyInputValue } from "../lib/format";
import { readMoneyDraft } from "../components/ui/money-input";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const recurringId = new RegExp(`^recurring:(${uuid}):(\\d{4}-\\d{2}(?:-\\d{2})?)$`, "i");

function validPeriod(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (year < 1 || month < 1 || month > 12) return false;
  if (!dayText) return true;
  const day = Number(dayText);
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Resolve only recurring/transfer forecast IDs; display names are never identifiers. */
export function resolveRecurringForecastId(event: Pick<ForecastEvent, "id" | "source" | "type">): string | null {
  if (event.source !== "recurring" && event.source !== "transfer") return null;
  if ((event.source === "transfer") !== (event.type === "transfer")) return null;
  const match = recurringId.exec(event.id);
  return match && validPeriod(match[2]) ? match[1] : null;
}

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
