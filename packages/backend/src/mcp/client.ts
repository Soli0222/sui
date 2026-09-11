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
