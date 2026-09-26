import type { CreateSubscriptionPayload, Recurrence, Subscription, SubscriptionAmountChange, SupportedCurrencyCode } from "@sui/shared";
import { addCalendarDays, formatSchedule } from "@sui/shared";
import type { EditChange } from "../editing/edit-surface";
import { formatCurrencyInputValue } from "../../lib/format";

export type SubscriptionForm = CreateSubscriptionPayload & {
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
};

export function subscriptionBasicPayload(saved: Subscription, draft: SubscriptionForm): CreateSubscriptionPayload {
  return { name: draft.name, amount: saved.amount, currencyCode: draft.currencyCode,
    exchangeRateToJpy: draft.exchangeRateToJpy, recurrence: draft.recurrence, interval: draft.interval,
    startDate: draft.startDate, dayOfMonth: draft.dayOfMonth, dayOfWeek: draft.dayOfWeek,
    endDate: draft.endDate, paymentSource: draft.paymentSource };
}

export function subscriptionInitialCorrectionPayload(saved: Subscription, amount: number): CreateSubscriptionPayload {
  return { name: saved.name, amount, currencyCode: saved.currencyCode, exchangeRateToJpy: saved.exchangeRateToJpy,
    recurrence: saved.recurrence, interval: saved.interval, startDate: saved.startDate,
    dayOfMonth: saved.dayOfMonth, dayOfWeek: saved.dayOfWeek, endDate: saved.endDate,
    paymentSource: saved.paymentSource };
}

export function makeEmptyForm(openedToday: string): SubscriptionForm { return {
  name: "",
  amount: 0,
  currencyCode: "JPY",
  exchangeRateToJpy: 1,
  recurrence: "monthly",
  interval: 1,
  startDate: openedToday,
  dayOfMonth: Number(openedToday.slice(8, 10)),
  dayOfWeek: null,
  endDate: null,
  paymentSource: null,
}; }

export function parseOptionalDate(value: string) {
  return value === "" ? null : value;
}

export function parseOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function isPeriodValid(startDate: string, endDate: string | null | undefined) {
  return !endDate || startDate <= endDate;
}

export function isValidExchangeRate(form: SubscriptionForm) {
  return form.currencyCode === "JPY" || form.exchangeRateToJpy > 0;
}

export function formatSubscriptionSchedule(subscription: Subscription) {
  return formatSchedule({
    recurrence: subscription.recurrence,
    interval: subscription.interval,
    dayOfMonth: subscription.dayOfMonth,
    dayOfWeek: subscription.dayOfWeek,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
  });
}

export function formatPeriod(startDate: string, endDate: string | null) {
  return `${startDate} 〜 ${endDate ?? "無期限"}`;
}

export interface SubscriptionPricePeriod {
  subscription: Subscription;
  amount: number;
  startDate: string;
  endDate: string | null;
  change: SubscriptionAmountChange | null;
  key: string;
}

/** Derive inclusive price periods clipped to the subscription contract. */
export function getSubscriptionPricePeriods(subscriptions: Subscription[], includeInvalid = false): SubscriptionPricePeriod[] {
  return subscriptions.flatMap((subscription) => {
    const changes = [...(subscription.amountChanges ?? [])].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    const prices = [{ amount: subscription.amount, effectiveFrom: subscription.startDate, change: null as SubscriptionAmountChange | null, key: "initial" },
      ...changes.map((change) => ({ amount: change.amount, effectiveFrom: change.effectiveFrom, change, key: change.id }))];

    return prices.flatMap((price, index) => {
      const startDate = price.effectiveFrom < subscription.startDate ? subscription.startDate : price.effectiveFrom;
      const nextDate = prices[index + 1]?.effectiveFrom;
      const priceEnd = nextDate ? addCalendarDays(nextDate, -1) : null;
      const endDate = subscription.endDate && priceEnd
        ? (subscription.endDate < priceEnd ? subscription.endDate : priceEnd)
        : subscription.endDate ?? priceEnd;
      return !includeInvalid && endDate && endDate < startDate ? [] : [{ subscription, amount: price.amount, startDate: includeInvalid && price.change ? price.effectiveFrom : startDate, endDate, change: price.change, key: price.key }];
    });
  });
}

export function getVisibleSubscriptionPricePeriods(subscription: Subscription, referenceDate: string): SubscriptionPricePeriod[] {
  return getSubscriptionPricePeriods([subscription]).filter((period) => period.endDate === null || period.endDate >= referenceDate);
}


export type SubscriptionMode = "detail" | "basic" | "schedule" | "initial" | "change" | "delete";
export type SubscriptionSelection = { subscription: Subscription; mode: SubscriptionMode; key: number; origin: HTMLElement; openedToday: string; changeId?: string };
export type SubscriptionDraft = { form: SubscriptionForm; date: string; amountRaw: string };

export function formFromSubscription(item: Subscription): SubscriptionForm {
  return { name: item.name, amount: item.amount, currencyCode: item.currencyCode,
    exchangeRateToJpy: item.exchangeRateToJpy, recurrence: item.recurrence, interval: item.interval,
    startDate: item.startDate, dayOfMonth: item.dayOfMonth, dayOfWeek: item.dayOfWeek,
    endDate: item.endDate, paymentSource: item.paymentSource };
}

export function subscriptionDraft(item: Subscription, mode: SubscriptionMode, change?: SubscriptionAmountChange) : SubscriptionDraft {
  const amount = mode === "initial" ? item.amount : change?.amount ?? item.effectiveAmount ?? item.amount;
  return { form: formFromSubscription(item), date: change?.effectiveFrom ?? "",
    amountRaw: formatCurrencyInputValue(amount, item.currencyCode) };
}

export function sessionStartDateFieldId(form: Pick<SubscriptionForm, "recurrence" | "interval">) {
  return form.recurrence === "monthly" && form.interval === 12 ? "subscription-schedule-month" : "subscription-start";
}

export function subscriptionFormErrors(form: SubscriptionForm, firstChangeDate: string | null = null) {
  const errors: Record<string, string> = {};
  if (!form.name.trim() || form.name.length > 100) errors.name = "サービス名を1〜100文字で入力してください。";
  if (!Number.isFinite(form.exchangeRateToJpy) || !isValidExchangeRate(form)) errors.exchangeRateToJpy = "JPY換算レートを入力してください。";
  if (!form.startDate) errors.startDate = "課金開始日を入力してください。";
  if (!isPeriodValid(form.startDate, form.endDate)) errors.endDate = "開始日は終了日以前にしてください。";
  if (firstChangeDate && form.startDate >= firstChangeDate) errors.startDate = `課金開始日は最初の価格変更日（${firstChangeDate}）より前にしてください。`;
  if (!Number.isInteger(form.interval) || form.interval < 1) errors.interval = "周期を確認してください。";
  if (form.recurrence === "monthly" && (form.dayOfMonth === null || form.dayOfMonth < 1 || form.dayOfMonth > 31)) errors.dayOfMonth = "課金日を確認してください。";
  if (form.recurrence === "weekly" && (form.dayOfWeek === null || form.dayOfWeek < 0 || form.dayOfWeek > 6)) errors.dayOfWeek = "曜日を確認してください。";
  if (form.paymentSource && form.paymentSource.length > 100) errors.paymentSource = "支払い元は100文字以内で入力してください。";
  return errors;
}

export function subscriptionBasicChanges(saved: Subscription, draft: SubscriptionForm): EditChange[] {
  const changes: EditChange[] = [];
  const add = (label: string, before: string | number | null | undefined, after: string | number | null | undefined) => {
    if (before !== after) changes.push({ label, before: before ?? "未設定", after: after ?? "未設定" });
  };
  add("サービス名", saved.name, draft.name);
  add("通貨", saved.currencyCode, draft.currencyCode);
  add("JPY換算レート", saved.exchangeRateToJpy, draft.exchangeRateToJpy);
  if (saved.recurrence !== draft.recurrence || saved.interval !== draft.interval ||
    saved.dayOfMonth !== draft.dayOfMonth || saved.dayOfWeek !== draft.dayOfWeek) {
    changes.push({ label: "周期・課金日", before: formatSubscriptionSchedule(saved), after: formatSchedule(draft) });
  }
  add("課金開始日", saved.startDate, draft.startDate);
  add("終了日", saved.endDate, draft.endDate);
  add("支払い元", saved.paymentSource, draft.paymentSource);
  return changes;
}
