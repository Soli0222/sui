import { INT4_MAX, type PersonSummaryResponse, type SettlementKind, type Transaction } from "@sui/shared";
import { readMoneyDraft } from "../ui/money-input";
import type { EditErrors } from "../../hooks/use-edit-session";
import { getTransactionSettlementRemaining } from "./split-helpers";

export type SettlementDraft = {
  personId: string; kind: SettlementKind; transactionId: string; date: string;
  offsetTotal: string; note: string; allocations: Record<string, string>;
};

export function validateSettlementDraft(draft: SettlementDraft, summary: PersonSummaryResponse | null,
  selectedTransaction: Transaction | undefined): EditErrors {
  const errors: EditErrors = {};
  if (!draft.personId) errors.personId = "メンバーを選択してください";
  if (draft.kind === "offset" && !draft.date) errors.date = "日付を入力してください";
  if (draft.kind === "transaction" && (!draft.transactionId || !selectedTransaction)) errors.transactionId = "振替取引を選択してください";
  if (draft.personId && !summary) errors.allocations = "持分の読み込みを待ってください";
  let allocated = 0;
  for (const [shareId, raw] of Object.entries(draft.allocations)) {
    if (!raw.trim()) continue;
    const amount = readMoneyDraft(raw, "JPY");
    if (amount.kind === "valid" && amount.minorUnits === 0) continue;
    const share = summary?.shares.find((item) => item.id === shareId && item.remainingAmount > 0);
    if (amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits <= 0 || amount.minorUnits > INT4_MAX) {
      errors[`allocation-${shareId}`] = "1円以上、上限以内の整数を入力してください";
    } else if (!share || amount.minorUnits > share.remainingAmount) {
      errors[`allocation-${shareId}`] = "未精算の残額以下にしてください";
    } else allocated += amount.minorUnits;
  }
  if (allocated === 0 && !errors.allocations) errors.allocations = "精算する持分を入力してください";
  if (draft.kind === "transaction" && selectedTransaction && allocated > getTransactionSettlementRemaining(selectedTransaction)) {
    errors.allocations = "振替取引の未充当額以下にしてください";
  }
  return errors;
}

export function distributeSettlement(totalAmount: number, shares: PersonSummaryResponse["shares"]) {
  const allocations: Record<string, string> = {};
  let remaining = totalAmount;
  for (const share of shares) {
    if (remaining <= 0) break;
    if (share.remainingAmount <= 0) continue;
    const amount = Math.min(share.remainingAmount, remaining);
    allocations[share.id] = String(amount);
    remaining -= amount;
  }
  return { allocations, remaining };
}
