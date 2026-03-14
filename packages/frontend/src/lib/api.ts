const JSON_HEADERS = {
  "Content-Type": "application/json",
};

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload as T;
}

