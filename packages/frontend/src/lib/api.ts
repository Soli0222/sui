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
    throw new Error("ネットワークに接続できません。通信状態を確認してください。");
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
