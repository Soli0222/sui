import type { Dispatcher } from "undici";

export type FetchLike = typeof fetch;

type FetchInit = RequestInit & { dispatcher?: Dispatcher };

async function parseErrorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }

  return `API error: ${response.status}`;
}

export class SuiApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly dispatcher?: Dispatcher,
  ) {}

  private buildInit(init: FetchInit): FetchInit {
    return this.dispatcher ? { ...init, dispatcher: this.dispatcher } : init;
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(
      new URL(path, this.baseUrl),
      this.buildInit({ method: "GET" }),
    );
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }
    return response.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(
      new URL(path, this.baseUrl),
      this.buildInit({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(
      new URL(path, this.baseUrl),
      this.buildInit({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }
    return response.json() as Promise<T>;
  }

  async delete(path: string): Promise<void> {
    const response = await this.fetchImpl(
      new URL(path, this.baseUrl),
      this.buildInit({ method: "DELETE" }),
    );
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }
  }
}
