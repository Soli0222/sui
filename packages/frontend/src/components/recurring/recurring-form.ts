import { DEFAULT_CURRENCY_CODE, INT4_MAX, isOneTimeSchedule, type Account, type DateShiftPolicy, type Recurrence, type RecurringItem, type RecurringItemType, type SupportedCurrencyCode } from "@sui/shared";

export type RecurringForm = {
  name: string;
  type: RecurringItemType;
  amount: number;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string | null;
  endDate: string | null;
  oneTime?: boolean;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string;
  transferToAccountId: string;
  enabled: boolean;
  sortOrder: number;
};

export function newRecurringForm(): RecurringForm {
  return {
    name: "", type: "expense", amount: 0, recurrence: "monthly", interval: 1,
    dayOfMonth: 1, dayOfWeek: 0, startDate: null, endDate: null, oneTime: false,
    dateShiftPolicy: "none", accountId: "", transferToAccountId: "", enabled: true, sortOrder: 0,
  };
}

export function formFromRecurring(item: RecurringItem): RecurringForm {
  return {
    name: item.name, type: item.type, amount: item.amount, recurrence: item.recurrence,
    interval: item.interval, dayOfMonth: item.dayOfMonth, dayOfWeek: item.dayOfWeek,
    startDate: item.startDate, endDate: item.endDate, oneTime: isOneTimeSchedule(item),
    dateShiftPolicy: item.dateShiftPolicy, accountId: item.accountId ?? "",
    transferToAccountId: item.transferToAccountId ?? "", enabled: item.enabled,
    sortOrder: item.sortOrder,
  };
}

export function getRecurringFormCurrencyCode(form: Pick<RecurringForm, "type" | "accountId" | "transferToAccountId">, accounts: Account[]): SupportedCurrencyCode {
  const id = form.type === "transfer" ? form.accountId || form.transferToAccountId : form.accountId;
  return accounts.find((account) => account.id === id)?.currencyCode ?? DEFAULT_CURRENCY_CODE;
}

export function getRecurringItemCurrencyCode(item: RecurringItem): SupportedCurrencyCode {
  return item.type === "transfer"
    ? item.account?.currencyCode ?? item.transferToAccount?.currencyCode ?? DEFAULT_CURRENCY_CODE
    : item.account?.currencyCode ?? DEFAULT_CURRENCY_CODE;
}

export function normalizeTransferToAccountId(form: RecurringForm, accounts: Account[]) {
  if (form.type !== "transfer") return "";
  const source = accounts.find((account) => account.id === form.accountId);
  const destination = accounts.find((account) => account.id === form.transferToAccountId);
  return destination && (!source || source.id !== destination.id && source.currencyCode === destination.currencyCode)
    ? destination.id : "";
}

export function recurringPayload(form: RecurringForm, amount = form.amount) {
  return {
    name: form.name, type: form.type, amount, recurrence: form.recurrence,
    interval: form.interval, dayOfMonth: form.recurrence === "monthly" ? form.dayOfMonth : null,
    dayOfWeek: form.recurrence === "weekly" ? form.dayOfWeek : null,
    startDate: form.startDate, endDate: form.endDate, dateShiftPolicy: form.dateShiftPolicy,
    accountId: form.accountId || null,
    transferToAccountId: form.type === "transfer" ? form.transferToAccountId || null : null,
    enabled: form.enabled, sortOrder: form.sortOrder,
  };
}

/** The basic editor never owns the initial amount, even if its form snapshot is stale. */
export function recurringBasicPayload(saved: RecurringItem, draft: RecurringForm) {
  return recurringPayload(draft, saved.amount);
}

/** A correction takes all unrelated values from the saved record, never another editor's draft. */
export function recurringInitialCorrectionPayload(saved: RecurringItem, correctedAmount: number) {
  return recurringPayload(formFromRecurring(saved), correctedAmount);
}

export function validateRecurringForm(form: RecurringForm, accounts: Account[], requireAmount: boolean) {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "カテゴリ名を入力してください。";
  else if (form.name.length > 100) errors.name = "カテゴリ名は100文字以下にしてください。";
  if (requireAmount && (!Number.isInteger(form.amount) || form.amount < 0 || form.amount > INT4_MAX)) errors.amount = "金額は0以上の有効な値を入力してください。";
  if (!Number.isInteger(form.interval) || form.interval < 1) errors.interval = "間隔は1以上にしてください。";
  if (form.oneTime && !form.startDate) errors.startDate = "予定日を入力してください。";
  if (form.recurrence === "monthly" && (form.dayOfMonth === null || form.dayOfMonth < 1 || form.dayOfMonth > 31)) errors.dayOfMonth = "発生日は1～31日で入力してください。";
  if (form.recurrence === "weekly" && (form.dayOfWeek === null || form.dayOfWeek < 0 || form.dayOfWeek > 6)) errors.dayOfWeek = "曜日を選択してください。";
  if (form.interval > 1 && !form.startDate) errors.startDate = "間隔を指定した予定には開始日が必要です。";
  if (form.startDate && form.endDate && form.startDate > form.endDate) errors.endDate = "終了日は開始日以降にしてください。";
  if (form.type === "transfer") {
    if (!form.accountId && !form.transferToAccountId) errors.accountId = "送金元または振替先を選択してください。";
    const source = accounts.find((account) => account.id === form.accountId);
    const destination = accounts.find((account) => account.id === form.transferToAccountId);
    if (source && destination && (source.id === destination.id || source.currencyCode !== destination.currencyCode)) errors.transferToAccountId = "振替先は異なる同一通貨の口座を選択してください。";
  } else if (!form.accountId) errors.accountId = "口座を選択してください。";
  if (!Number.isInteger(form.sortOrder) || form.sortOrder > INT4_MAX || form.sortOrder < -INT4_MAX - 1) errors.sortOrder = "表示順を整数で入力してください。";
  return errors;
}
