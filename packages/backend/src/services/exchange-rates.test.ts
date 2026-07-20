import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchExchangeRateToJpy,
  refreshExchangeRatesToJpy,
  resetExchangeRateRefreshStateForTest,
} from "./exchange-rates";

function createJsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("exchange rates service", () => {
  beforeEach(() => {
    resetExchangeRateRefreshStateForTest();
  });

  it("fetches a JPY pair rate", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ rate: 160.25 }));

    await expect(fetchExchangeRateToJpy("USD", {
      apiBaseUrl: "https://example.com/v2",
      fetchImpl,
    })).resolves.toBe(160.25);

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://example.com/v2/rate/USD/JPY"),
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
  });

  it("accepts a rates map response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ rates: { JPY: 171.5 } }));

    await expect(fetchExchangeRateToJpy("EUR", { fetchImpl })).resolves.toBe(171.5);
  });

  it("rejects a response without a positive JPY rate", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ rate: 0 }));

    await expect(fetchExchangeRateToJpy("USD", { fetchImpl })).rejects.toThrow(
      "Exchange rate API response did not include a positive JPY rate",
    );
  });

  it("updates active foreign-currency accounts and subscriptions with fetched rates", async () => {
    const now = new Date("2026-06-13T00:00:00.000Z");
    const accountUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const subscriptionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const store = {
      account: {
        findMany: vi.fn().mockResolvedValue([
          { currencyCode: "USD" },
          { currencyCode: "USD" },
          { currencyCode: "EUR" },
          { currencyCode: "JPY" },
          { currencyCode: "AUD" },
        ]),
        updateMany: accountUpdateMany,
      },
      subscription: {
        findMany: vi.fn().mockResolvedValue([
          { currencyCode: "USD" },
          { currencyCode: "EUR" },
        ]),
        updateMany: subscriptionUpdateMany,
      },
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ rate: 160.25 }))
      .mockResolvedValueOnce(createJsonResponse({ rate: 171.5 }));

    await refreshExchangeRatesToJpy(store, {
      apiBaseUrl: "https://example.com/v2",
      fetchImpl,
      force: true,
      now,
    });

    expect(accountUpdateMany).toHaveBeenCalledTimes(2);
    expect(accountUpdateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, currencyCode: "USD" },
      data: {
        exchangeRateToJpy: 160.25,
        exchangeRateUpdatedAt: now,
      },
    });
    expect(accountUpdateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, currencyCode: "EUR" },
      data: {
        exchangeRateToJpy: 171.5,
        exchangeRateUpdatedAt: now,
      },
    });
    expect(subscriptionUpdateMany).toHaveBeenCalledTimes(2);
    expect(subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, currencyCode: "USD" },
      data: {
        exchangeRateToJpy: 160.25,
        exchangeRateUpdatedAt: now,
      },
    });
    expect(subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, currencyCode: "EUR" },
      data: {
        exchangeRateToJpy: 171.5,
        exchangeRateUpdatedAt: now,
      },
    });
  });
});
