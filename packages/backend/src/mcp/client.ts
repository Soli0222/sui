import type { Hono } from "hono";

export interface SuiApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

async function parseErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }

  return `API error: ${response.status}`;
}

const CLIENT_HEADERS = {
  "x-sui-client": "mcp",
};

export class InProcessSuiApiClient implements SuiApiClient {
  constructor(
    private readonly app: Hono,
    private readonly token?: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { ...CLIENT_HEADERS };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await this.app.request(path, init);
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete(path: string): Promise<void> {
    return this.request<void>("DELETE", path);
  }
}
