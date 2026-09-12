import type { CreditCardAssumptionSuggestionResponse } from "@sui/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/api";
import { useAssumptionSuggestion } from "./use-assumption-suggestion";

vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function deferred() {
  let resolve!: (value: CreditCardAssumptionSuggestionResponse) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<CreditCardAssumptionSuggestionResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each([false, true])("ignores a stale card response/error after switching cards (reject=%s)", async (reject) => {
  const old = deferred();
  const current = deferred();
  vi.mocked(apiFetch).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { result } = renderHook(useAssumptionSuggestion);
  let pendingOld!: Promise<void>;
  let pendingCurrent!: Promise<void>;
  act(() => { pendingOld = result.current.load("card-a"); });
  act(() => { result.current.reset(); });
  expect(result.current.loading).toBe(false);
  act(() => { pendingCurrent = result.current.load("card-b"); });
  await act(async () => {
    if (reject) old.reject(new Error("Old card failed"));
    else old.resolve({ suggestedAmount: 100 } as CreditCardAssumptionSuggestionResponse);
    await pendingOld;
  });
  expect(result.current).toMatchObject({ suggestion: null, loading: true, error: null });
  await act(async () => {
    current.resolve({ suggestedAmount: 200 } as CreditCardAssumptionSuggestionResponse);
    await pendingCurrent;
  });
  expect(result.current).toMatchObject({ suggestion: { suggestedAmount: 200 }, loading: false, error: null });
});

it("discards a response after closing and reopening the same card", async () => {
  const old = deferred();
  vi.mocked(apiFetch).mockReturnValue(old.promise);
  const { result } = renderHook(useAssumptionSuggestion);
  let pending!: Promise<void>;
  act(() => { pending = result.current.load("card-a"); });
  act(() => { result.current.reset(); result.current.reset(); });
  await act(async () => { old.resolve({ suggestedAmount: 100 } as CreditCardAssumptionSuggestionResponse); await pending; });
  expect(result.current).toMatchObject({ suggestion: null, loading: false, error: null });
});
