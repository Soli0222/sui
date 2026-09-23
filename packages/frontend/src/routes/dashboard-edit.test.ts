import { describe, expect, it } from "vitest";
import type { ForecastEvent } from "@sui/shared";
import { confirmationAmount, createConfirmationDraft, isConfirmationStale, resolveRecurringForecastId } from "./dashboard-edit";

const id = "00000000-0000-4000-8000-000000000001";
const event = { id: `recurring:${id}:2026-02`, source: "recurring", type: "expense", date: "2026-02-28",
  amount: 125, currencyCode: "USD", accountId: null, transferToAccountId: null } as ForecastEvent;

describe("dashboard recurring target", () => {
  it("resolves monthly and weekly recurring or transfer IDs, never names or other sources", () => {
    expect(resolveRecurringForecastId(event)).toBe(id);
    expect(resolveRecurringForecastId({ ...event, id: `recurring:${id}:2028-02-29` })).toBe(id);
    expect(resolveRecurringForecastId({ ...event, source: "transfer", type: "transfer" })).toBe(id);
    expect(resolveRecurringForecastId({ ...event, source: "credit-card" })).toBeNull();
    expect(resolveRecurringForecastId({ ...event, id: `recurring:${id}:2026-02-30` })).toBeNull();
    expect(resolveRecurringForecastId({ ...event, id: "recurring:通信費:2026-02" })).toBeNull();
    expect(resolveRecurringForecastId({ ...event, source: "transfer" })).toBeNull();
  });
});

describe("overdue confirmation drafts", () => {
  it("keeps zero distinct from empty and converts currency decimals to minor units", () => {
    expect(confirmationAmount("", "JPY")).toBeNull();
    expect(confirmationAmount("0", "JPY")).toBe(0);
    expect(confirmationAmount("1.25", "USD")).toBe(125);
    expect(confirmationAmount("1.", "EUR")).toBeNull();
    expect(confirmationAmount("-1", "USD")).toBeNull();
    expect(confirmationAmount("2147483648", "JPY")).toBeNull();
  });

  it("marks a retained draft for review when the source event changes", () => {
    const draft = createConfirmationDraft(event, "account");
    expect(isConfirmationStale(draft, event)).toBe(false);
    expect(isConfirmationStale(draft, { ...event, amount: 200 })).toBe(true);
    expect(isConfirmationStale(draft, { ...event, date: "2026-03-01" })).toBe(true);
  });
});
