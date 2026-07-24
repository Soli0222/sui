import { reportFetchFailure, reportFetchSuccess } from "./network-status";

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
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
    reportFetchFailure();
    throw new NetworkError("ネットワークに接続できません。通信状態を確認してください。");
  }

  reportFetchSuccess();

  if (response.status === 401) {
    notifyUnauthorized();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload as T;
}
