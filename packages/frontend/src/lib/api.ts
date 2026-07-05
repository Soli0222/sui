import { reportFetchFailure, reportFetchSuccess } from "./network-status";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "x-sui-client": "web",
};

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
    throw new Error("ネットワークに接続できません。通信状態を確認してください。");
  }

  // ステータスに関わらず応答が返ってきたのはオンラインの証拠。
  reportFetchSuccess();

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload as T;
}
