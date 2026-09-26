import type { APIRequestContext } from "@playwright/test";

// Seed through the authenticated HTTP context without depending on Vite source URLs.
export function createApiClient(request: APIRequestContext) {
  return async <T = unknown>(url: string, init?: { method: string; body?: string }): Promise<T> => {
    const response = await request.fetch(url, {
      method: init?.method,
      data: init?.body,
      headers: { "Content-Type": "application/json", "x-sui-client": "web" },
    });
    if (!response.ok()) throw new Error(`${url}: ${response.status()} ${await response.text()}`);
    return response.status() === 204 ? undefined as T : await response.json() as T;
  };
}
