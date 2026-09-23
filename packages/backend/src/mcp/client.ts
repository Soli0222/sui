import type { Hono } from "hono";
import type { McpOAuthService } from "../lib/mcp-oauth";
import type { InternalAuthBridge } from "./internal-auth";
import type { McpRequestAuth } from "./request-context";

export interface SuiApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export interface McpInternalRequestSnapshot {
  method: string;
  path: string;
  authKind: McpRequestAuth["kind"] | "staticToken";
  readOnly: boolean;
}

// Only validation field messages are public; never forward arbitrary error bodies.
export function safeErrorText(value: string): string {
  return value.replace(/Bearer\s+\S+|sui_tok_[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi, "[redacted]");
}

export class SuiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly details?: { formErrors: string[]; fieldErrors: Record<string, string[]> },
  ) {
    super(safeErrorText(message));
  }
}

async function parseApiError(response: Response): Promise<SuiApiError> {
  const body = await response.json().catch(() => null);
  const message = typeof body?.error === "string" ? body.error : `API error: ${response.status}`;
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(safeErrorText)
    : [];
  const details = body?.details && typeof body.details === "object" ? {
    formErrors: strings(body.details.formErrors),
    fieldErrors: Object.fromEntries(Object.entries(body.details.fieldErrors ?? {})
      .filter(([key]) => !/token|secret|password|authorization|cookie|stack/i.test(key))
      .map(([key, value]) => [key, strings(value)])),
  } : undefined;
  return new SuiApiError(message, response.status, response.headers.get("x-request-id"), details);
}

const CLIENT_HEADERS = {
  "x-sui-client": "mcp",
};

export class InProcessSuiApiClient implements SuiApiClient {
  private readonly staticToken?: string;
  private readonly getAuth?: () => McpRequestAuth | undefined;
  private readonly internalAuthBridge?: InternalAuthBridge;
  private readonly oauthService?: McpOAuthService | null;
  private readonly beforeRequest?: (request: McpInternalRequestSnapshot) => void | Promise<void>;

  constructor(
    private readonly app: Hono,
    tokenOrOptions?: string | {
      getAuth: () => McpRequestAuth | undefined;
      internalAuthBridge: InternalAuthBridge;
      oauthService: McpOAuthService | null;
      beforeRequest?: (request: McpInternalRequestSnapshot) => void | Promise<void>;
    },
  ) {
    if (typeof tokenOrOptions === "string") {
      this.staticToken = tokenOrOptions;
    } else if (tokenOrOptions) {
      this.getAuth = tokenOrOptions.getAuth;
      this.internalAuthBridge = tokenOrOptions.internalAuthBridge;
      this.oauthService = tokenOrOptions.oauthService;
      this.beforeRequest = tokenOrOptions.beforeRequest;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const auth = this.getAuth?.();
    if (this.getAuth && !auth) {
      throw new Error("MCP request authentication context is unavailable");
    }
    await this.beforeRequest?.({
      method,
      path,
      authKind: this.staticToken ? "staticToken" : auth?.kind ?? "staticToken",
      readOnly: auth?.kind === "apiToken"
        ? auth.readOnly
        : auth?.kind === "oauth"
          ? auth.principal.readOnly
          : false,
    });

    const headers: Record<string, string> = { ...CLIENT_HEADERS };
    const token = this.staticToken ?? (auth?.kind === "apiToken" ? auth.token : undefined);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const request = new Request(new URL(path, "http://localhost"), init);
    let response: Response;
    if (auth?.kind === "oauth") {
      if (!this.internalAuthBridge || !this.oauthService) {
        throw new Error("MCP OAuth internal authentication is unavailable");
      }
      this.oauthService.assertPrincipalCurrent(auth.principal);
      response = await this.internalAuthBridge.run(
        request,
        {
          kind: "oauth",
          readOnly: auth.principal.readOnly,
          subject: auth.principal.subject,
          issuer: auth.principal.issuer,
          oauthClientId: auth.principal.clientId,
          scopes: auth.principal.scopes,
          expiresAt: auth.principal.expiresAt,
          resource: auth.principal.resource,
          authMode: "enabled",
        },
        () => this.app.request(request),
      );
    } else {
      response = await this.app.request(request);
    }
    if (!response.ok) {
      throw await parseApiError(response);
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
