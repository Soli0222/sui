import { describe, expect, it } from "vitest";
import type { ForecastEvent } from "@sui/shared";
import { confirmationAmount, createConfirmationDraft, isConfirmationStale } from "./dashboard-confirmation";

const id = "00000000-0000-4000-8000-000000000001";
const event = { id: `recurring:${id}:2026-02`, source: "recurring", type: "expense", date: "2026-02-28",
  amount: 125, currencyCode: "USD", accountId: null, transferToAccountId: null } as ForecastEvent;

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
