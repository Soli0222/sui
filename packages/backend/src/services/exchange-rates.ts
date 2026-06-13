import {
  DEFAULT_CURRENCY_CODE,
  isSupportedCurrencyCode,
  type SupportedCurrencyCode,
} from "@sui/shared";

const EXCHANGE_RATE_API_BASE_URL = "https://api.frankfurter.dev/v2";
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

type AccountExchangeRateStore = {
  account: {
    findMany(args: {
      where: {
        deletedAt: null;
        currencyCode: { not: SupportedCurrencyCode };
      };
      select: { currencyCode: true };
    }): Promise<Array<{ currencyCode: string }>>;
    updateMany(args: {
      where: {
        deletedAt: null;
        currencyCode: SupportedCurrencyCode;
      };
      data: {
        exchangeRateToJpy: number;
        exchangeRateUpdatedAt: Date;
      };
    }): Promise<unknown>;
  };
};

type FetchExchangeRateOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type RefreshExchangeRatesOptions = FetchExchangeRateOptions & {
  force?: boolean;
  now?: Date;
  refreshIntervalMs?: number;
};

let lastRefreshAttemptAt = 0;
let inFlightRefresh: Promise<void> | null = null;

function getPositiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getNonNegativeEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getExchangeRateApiBaseUrl() {
  return process.env.SUI_EXCHANGE_RATE_API_BASE_URL ?? EXCHANGE_RATE_API_BASE_URL;
}

function getRefreshIntervalMs() {
  return getNonNegativeEnvNumber("SUI_EXCHANGE_RATE_REFRESH_INTERVAL_MS", DEFAULT_REFRESH_INTERVAL_MS);
}

function getRequestTimeoutMs() {
  return getPositiveEnvNumber("SUI_EXCHANGE_RATE_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS);
}

function buildPairRateUrl(apiBaseUrl: string, currencyCode: SupportedCurrencyCode) {
  const normalizedBaseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  return new URL(`rate/${currencyCode}/JPY`, normalizedBaseUrl);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readRateFromPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const directRate = getPositiveNumber(payload.rate);
  if (directRate !== null) {
    return directRate;
  }

  if (isRecord(payload.rates)) {
    return getPositiveNumber(payload.rates.JPY);
  }

  return null;
}

function resolveFetch(fetchImpl?: typeof fetch) {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new Error("Global fetch is not available");
  }

  return globalThis.fetch.bind(globalThis) as typeof fetch;
}

export async function fetchExchangeRateToJpy(
  currencyCode: SupportedCurrencyCode,
  {
    apiBaseUrl = getExchangeRateApiBaseUrl(),
    fetchImpl,
    timeoutMs = getRequestTimeoutMs(),
  }: FetchExchangeRateOptions = {},
) {
  if (currencyCode === DEFAULT_CURRENCY_CODE) {
    return 1;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await resolveFetch(fetchImpl)(buildPairRateUrl(apiBaseUrl, currencyCode), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Exchange rate API returned ${response.status}`);
    }

    const rate = readRateFromPayload(await response.json());
    if (rate === null) {
      throw new Error("Exchange rate API response did not include a positive JPY rate");
    }

    return rate;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshExchangeRatesToJpyNow(
  store: AccountExchangeRateStore,
  options: RefreshExchangeRatesOptions,
) {
  const accounts = await store.account.findMany({
    where: {
      deletedAt: null,
      currencyCode: { not: DEFAULT_CURRENCY_CODE },
    },
    select: { currencyCode: true },
  });
  const currencyCodes = Array.from(
    new Set(
      accounts
        .map((account) => account.currencyCode.toUpperCase())
        .filter((currencyCode): currencyCode is SupportedCurrencyCode =>
          currencyCode !== DEFAULT_CURRENCY_CODE && isSupportedCurrencyCode(currencyCode),
        ),
    ),
  );

  const fetchedAt = options.now ?? new Date();
  const rates = await Promise.all(
    currencyCodes.map(async (currencyCode) => {
      try {
        return {
          currencyCode,
          exchangeRateToJpy: await fetchExchangeRateToJpy(currencyCode, options),
        };
      } catch (error) {
        console.warn(`Failed to refresh ${currencyCode}/JPY exchange rate`, error);
        return null;
      }
    }),
  );

  await Promise.all(
    rates.map((rate) => {
      if (!rate) {
        return Promise.resolve();
      }

      return store.account.updateMany({
        where: {
          deletedAt: null,
          currencyCode: rate.currencyCode,
        },
        data: {
          exchangeRateToJpy: rate.exchangeRateToJpy,
          exchangeRateUpdatedAt: fetchedAt,
        },
      });
    }),
  );
}

export async function refreshExchangeRatesToJpy(
  store: AccountExchangeRateStore,
  options: RefreshExchangeRatesOptions = {},
) {
  const now = options.now ?? new Date();
  const refreshIntervalMs = options.refreshIntervalMs ?? getRefreshIntervalMs();

  if (!options.force && now.getTime() - lastRefreshAttemptAt < refreshIntervalMs) {
    return;
  }
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  lastRefreshAttemptAt = now.getTime();
  inFlightRefresh = refreshExchangeRatesToJpyNow(store, options).finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

export function resetExchangeRateRefreshStateForTest() {
  lastRefreshAttemptAt = 0;
  inFlightRefresh = null;
}
