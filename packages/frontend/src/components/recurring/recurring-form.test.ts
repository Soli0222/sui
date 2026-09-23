import { describe, expect, it } from "vitest";
import type { RecurringItem } from "@sui/shared";
import { formFromRecurring, recurringBasicPayload, recurringInitialCorrectionPayload } from "./recurring-form";

function savedItem(): RecurringItem {
  return {
    id: "item-1", name: "通信費", type: "expense", amount: 8000,
    amountChanges: [{ id: "change-1", recurringItemId: "item-1", effectiveFrom: "2026-11-01",
      amount: 9000, createdAt: "", updatedAt: "" }],
    effectiveAmount: 8000, recurrence: "monthly", interval: 1,
    dayOfMonth: 1, dayOfWeek: null, startDate: null, endDate: null,
    dateShiftPolicy: "none", accountId: "account-1", account: null,
    transferToAccountId: null, transferToAccount: null, enabled: true,
    sortOrder: 0, deletedAt: null, createdAt: "", updatedAt: "",
  };
}

describe("recurring edit payload boundaries", () => {
  it("corrects only the saved item's initial amount while another basic draft is unsaved", () => {
    const saved = savedItem();
    const unsavedBasic = { ...formFromRecurring(saved), name: "携帯代", dayOfMonth: 5 };
    const payload = recurringInitialCorrectionPayload(saved, 8500);

    expect(payload).toMatchObject({ name: "通信費", dayOfMonth: 1, amount: 8500 });
    expect(payload.name).not.toBe(unsavedBasic.name);
    expect(payload.dayOfMonth).not.toBe(unsavedBasic.dayOfMonth);
    expect("amountChanges" in payload).toBe(false);
  });

  it("keeps a corrected initial amount when basic information is later saved", () => {
    const latest = { ...savedItem(), amount: 8500 };
    const staleBasicDraft = { ...formFromRecurring(savedItem()), name: "通信費", dayOfMonth: 5 };
    const payload = recurringBasicPayload(latest, staleBasicDraft);

    expect(payload).toMatchObject({ amount: 8500, dayOfMonth: 5 });
    expect("amountChanges" in payload).toBe(false);
  });
});
