import { reportFetchFailure, reportFetchSuccess } from "./network-status";

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "x-sui-client": "web",
};

const unauthorizedListeners = new Set<() => void>();

export function registerUnauthorizedCallback(callback: () => void) {
  unauthorizedListeners.add(callback);
  return () => {
    unauthorizedListeners.delete(callback);
  };
}

function notifyUnauthorized() {
  for (const listener of unauthorizedListeners) {
    listener();
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...JSON_HEADERS,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // fetch 自体の例外は大抵オフラインが原因（B-1 オフラインバナー）。
    reportFetchFailure();
    throw new NetworkError("ネットワークに接続できません。通信状態を確認してください。");
  }

  // ステータスに関わらず応答が返ってきたのはオンラインの証拠。
  reportFetchSuccess();

  if (response.status === 401) {
    notifyUnauthorized();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new ApiError(payload.error ?? "Request failed", response.status);
  }

  return payload as T;
}
