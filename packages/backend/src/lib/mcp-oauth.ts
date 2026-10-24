import { createHash } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  errors,
  jwtVerify,
  type FetchImplementation,
  type RemoteJWKSet,
} from "jose";

const DISCOVERY_CACHE_MS = 10 * 60 * 1000;
const DISCOVERY_FAILURE_CACHE_MS = 5_000;
const FETCH_TIMEOUT_MS = 5_000;
const CLOCK_TOLERANCE_SECONDS = 5;
const OAUTH_RATE_LIMIT_WINDOW_MS = 60_000;

export const MCP_OAUTH_SCOPES = ["read:sui", "write:sui"] as const;

export interface McpOAuthConfig {
  resourceUrl: string;
  metadataUrl: string;
  configuredIssuer: string;
}

export interface McpOAuthProviderMetadata {
  issuer: string;
  jwksUri: string;
}

export interface McpOAuthPrincipal {
  readonly kind: "oauth";
  readonly issuer: string;
  readonly subject: string;
  readonly clientId: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
  readonly readOnly: boolean;
}

export type McpOAuthFailureKind = "invalid_token" | "insufficient_scope" | "forbidden" | "rate_limited" | "unavailable";

export interface McpAuthFailure {
  reason: McpOAuthFailureKind | "missing_bearer" | "invalid_api_token" | "oauth_disabled"
    | "invalid_token_type" | "invalid_claim" | "future_iat" | "expired_token"
    | "invalid_signature" | "unsupported_algorithm" | "signing_key_not_found" | "malformed_token";
  claim?: "iss" | "aud" | "sub" | "exp" | "iat" | "nbf" | "client_id" | "azp" | "jti" | "scope";
}

export class McpOAuthError extends Error {
  readonly diagnostic: McpAuthFailure;

  constructor(
    readonly kind: McpOAuthFailureKind,
    message: string,
    options?: ErrorOptions & { diagnostic?: McpAuthFailure },
    readonly verifiedPrincipal?: McpOAuthPrincipal,
  ) {
    super(message, options);
    this.name = "McpOAuthError";
    this.diagnostic = options?.diagnostic ?? { reason: kind };
  }
}

export interface CreateMcpOAuthServiceOptions {
  authMode: "enabled" | "disabled";
  env?: NodeJS.ProcessEnv;
  envProvider?: () => NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  allowInsecureUrlsForTests?: boolean;
  now?: () => number;
}

interface CachedProvider {
  expiresAt: number;
  metadata: McpOAuthProviderMetadata;
  jwks: RemoteJWKSet;
}

class OAuthJwksUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("OAuth provider JWKS is unavailable", options);
    this.name = "OAuthJwksUnavailableError";
  }
}

function parseList(value: string | undefined) {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function parsePositiveInt(value: string | undefined, defaultValue: number) {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}

function assertUrl(
  raw: string,
  label: string,
  allowInsecureUrlsForTests: boolean,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }

  const secure = url.protocol === "https:";
  const testOnlyHttp = allowInsecureUrlsForTests && url.protocol === "http:";
  if (!secure && !testOnlyHttp) {
    throw new Error(`${label} must use HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain userinfo, query, or fragment`);
  }
  return url;
}

function issuerTarget(url: URL) {
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

function isSameIssuerTarget(left: string, right: string, allowInsecureUrlsForTests: boolean) {
  try {
    return issuerTarget(assertUrl(left, "SUI_OIDC_ISSUER", allowInsecureUrlsForTests))
      === issuerTarget(assertUrl(right, "discovery issuer", allowInsecureUrlsForTests));
  } catch {
    return false;
  }
}

function buildMetadataUrl(resource: URL) {
  return new URL(`/.well-known/oauth-protected-resource${resource.pathname}`, resource.origin).href;
}

function discoveryUrl(issuer: URL) {
  const path = issuer.pathname.replace(/\/+$/, "");
  return new URL(`${path}/.well-known/openid-configuration`, issuer.origin);
}

function hasRequiredIntegerClaim(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function joseFailureKind(error: unknown): McpOAuthFailureKind {
  if (error instanceof OAuthJwksUnavailableError) {
    return "unavailable";
  }
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_FETCH_FAILED") {
    return "unavailable";
  }
  return "invalid_token";
}

function joseFailureDiagnostic(error: unknown): McpAuthFailure {
  if (error instanceof errors.JWTExpired) return { reason: "expired_token", claim: "exp" };
  if (error instanceof errors.JWTClaimValidationFailed) {
    // Never pass through claim values, payloads, messages, or arbitrary claim names.
    const claim = (["iss", "aud", "sub", "exp", "iat", "nbf"] as const)
      .find((name) => name === error.claim);
    return { reason: "invalid_claim", ...(claim ? { claim } : {}) };
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) return { reason: "invalid_signature" };
  if (error instanceof errors.JOSEAlgNotAllowed) return { reason: "unsupported_algorithm" };
  if (error instanceof errors.JWKSNoMatchingKey) return { reason: "signing_key_not_found" };
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return { reason: "malformed_token" };
  return { reason: joseFailureKind(error) };
}

export class McpOAuthService {
  private cachedProvider: CachedProvider | null = null;
  private providerPromise: Promise<CachedProvider> | null = null;
  private providerFailure: { error: McpOAuthError; expiresAt: number } | null = null;
  private oauthRequestTimestamps: number[] = [];
  private activeOAuthRequests = 0;

  constructor(
    readonly config: McpOAuthConfig,
    private readonly configuredIssuerUrl: URL,
    private readonly options: Required<Pick<CreateMcpOAuthServiceOptions, "allowInsecureUrlsForTests" | "now">> & {
      fetch: typeof globalThis.fetch;
      envProvider: () => NodeJS.ProcessEnv;
    },
  ) {}

  private async withPreAuthLimit<T>(operation: () => Promise<T>): Promise<T> {
    const now = this.options.now();
    const env = this.options.envProvider();
    const maxRequests = parsePositiveInt(env.SUI_MCP_OAUTH_MAX_REQUESTS_PER_MINUTE, 120);
    const maxConcurrent = parsePositiveInt(env.SUI_MCP_OAUTH_MAX_CONCURRENT_REQUESTS, 10);
    this.oauthRequestTimestamps = this.oauthRequestTimestamps.filter(
      (timestamp) => timestamp > now - OAUTH_RATE_LIMIT_WINDOW_MS,
    );
    if (this.oauthRequestTimestamps.length >= maxRequests) {
      throw new McpOAuthError("rate_limited", "Too many OAuth authentication requests");
    }
    if (this.activeOAuthRequests >= maxConcurrent) {
      throw new McpOAuthError("unavailable", "Too many concurrent OAuth authentication requests");
    }
    this.oauthRequestTimestamps.push(now);
    this.activeOAuthRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeOAuthRequests -= 1;
    }
  }

  private async fetchProvider(): Promise<CachedProvider> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let document: unknown;
    try {
      const response = await this.options.fetch(discoveryUrl(this.configuredIssuerUrl), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new McpOAuthError("unavailable", "OAuth provider discovery is unavailable");
      }
      document = await response.json();
    } catch (error) {
      if (error instanceof McpOAuthError) throw error;
      throw new McpOAuthError("unavailable", "OAuth provider discovery is unavailable", { cause: error });
    } finally {
      clearTimeout(timeout);
    }

    if (!document || typeof document !== "object") {
      throw new McpOAuthError("unavailable", "OAuth provider discovery returned invalid metadata");
    }

    const issuer = (document as { issuer?: unknown }).issuer;
    const jwksUri = (document as { jwks_uri?: unknown }).jwks_uri;
    if (typeof issuer !== "string" || typeof jwksUri !== "string") {
      throw new McpOAuthError("unavailable", "OAuth provider discovery omitted required metadata");
    }
    if (!isSameIssuerTarget(this.config.configuredIssuer, issuer, this.options.allowInsecureUrlsForTests)) {
      throw new McpOAuthError("unavailable", "OAuth provider discovery issuer does not match configuration");
    }

    let canonicalIssuer: URL;
    let jwksUrl: URL;
    try {
      canonicalIssuer = assertUrl(issuer, "discovery issuer", this.options.allowInsecureUrlsForTests);
      jwksUrl = assertUrl(jwksUri, "discovery jwks_uri", this.options.allowInsecureUrlsForTests);
    } catch (error) {
      throw new McpOAuthError("unavailable", "OAuth provider discovery contains an invalid URL", { cause: error });
    }
    if (jwksUrl.origin !== canonicalIssuer.origin) {
      throw new McpOAuthError("unavailable", "OAuth provider JWKS must use the issuer origin");
    }

    const fetchImplementation: FetchImplementation = async (url, init) => {
      try {
        const response = await this.options.fetch(url, init);
        if (response.status !== 200) {
          throw new OAuthJwksUnavailableError();
        }
        const json = await response.clone().json() as { keys?: unknown };
        if (!json || typeof json !== "object" || !Array.isArray(json.keys)) {
          throw new OAuthJwksUnavailableError();
        }
        return response;
      } catch (error) {
        if (error instanceof OAuthJwksUnavailableError) throw error;
        throw new OAuthJwksUnavailableError({ cause: error });
      }
    };
    const jwks = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: FETCH_TIMEOUT_MS,
      cooldownDuration: 5_000,
      cacheMaxAge: DISCOVERY_CACHE_MS,
      [customFetch]: fetchImplementation,
    });
    return {
      expiresAt: this.options.now() + DISCOVERY_CACHE_MS,
      metadata: { issuer, jwksUri: jwksUrl.href },
      jwks,
    };
  }

  private async getProvider(): Promise<CachedProvider> {
    if (this.cachedProvider && this.cachedProvider.expiresAt > this.options.now()) {
      return this.cachedProvider;
    }
    if (this.providerFailure && this.providerFailure.expiresAt > this.options.now()) {
      throw this.providerFailure.error;
    }
    if (!this.providerPromise) {
      this.providerPromise = this.fetchProvider()
        .then((provider) => {
          this.cachedProvider = provider;
          this.providerFailure = null;
          return provider;
        })
        .catch((error: unknown) => {
          const failure = error instanceof McpOAuthError
            ? error
            : new McpOAuthError("unavailable", "OAuth provider is unavailable", { cause: error });
          this.providerFailure = {
            error: failure,
            expiresAt: this.options.now() + DISCOVERY_FAILURE_CACHE_MS,
          };
          throw failure;
        })
        .finally(() => {
          this.providerPromise = null;
        });
    }
    return this.providerPromise;
  }

  async getProviderMetadata() {
    return this.withPreAuthLimit(async () => (await this.getProvider()).metadata);
  }

  async verifyAccessToken(token: string): Promise<McpOAuthPrincipal> {
    return this.withPreAuthLimit(() => this.verifyAccessTokenWithoutLimit(token));
  }

  private async verifyAccessTokenWithoutLimit(token: string): Promise<McpOAuthPrincipal> {
    let provider: CachedProvider;
    try {
      provider = await this.getProvider();
    } catch (error) {
      if (error instanceof McpOAuthError) throw error;
      throw new McpOAuthError("unavailable", "OAuth provider is unavailable", { cause: error });
    }

    try {
      const { payload, protectedHeader } = await jwtVerify(token, provider.jwks, {
        algorithms: ["RS256"],
        issuer: provider.metadata.issuer,
        audience: this.config.resourceUrl,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });

      const typ = protectedHeader.typ?.toLowerCase();
      // Both formats are checked after signature, issuer and audience verification.
      // Generic JWT typing alone does not distinguish access tokens from ID/refresh tokens.
      const rfc9068 = typ === "at+jwt" || typ === "application/at+jwt";
      const bearerJwt = typ === "jwt" && payload.typ === "Bearer";
      if (!rfc9068 && !bearerJwt) {
        throw new McpOAuthError("invalid_token", "OAuth access token has an invalid token type", {
          diagnostic: { reason: "invalid_token_type" },
        });
      }
      const clientId = rfc9068 ? payload.client_id : payload.azp;
      const requiredClaims: [NonNullable<McpAuthFailure["claim"]>, boolean][] = [
        ["iss", typeof payload.iss === "string"],
        ["sub", typeof payload.sub === "string" && payload.sub.length > 0],
        ["exp", hasRequiredIntegerClaim(payload.exp)],
        ["iat", hasRequiredIntegerClaim(payload.iat)],
        [rfc9068 ? "client_id" : "azp", typeof clientId === "string" && clientId.length > 0],
        ["jti", typeof payload.jti === "string" && payload.jti.length > 0],
        ["nbf", payload.nbf === undefined || hasRequiredIntegerClaim(payload.nbf)],
      ];
      const invalidClaim = requiredClaims.find(([, valid]) => !valid)?.[0];
      if (invalidClaim) {
        throw new McpOAuthError("invalid_token", "OAuth access token is missing required claims", {
          diagnostic: { reason: "invalid_claim", claim: invalidClaim },
        });
      }
      const issuedAt = payload.iat as number;
      const expiresAt = payload.exp as number;
      const nowSeconds = Math.floor(this.options.now() / 1000);
      if (issuedAt > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
        throw new McpOAuthError("invalid_token", "OAuth access token has a future iat claim", {
          diagnostic: { reason: "future_iat", claim: "iat" },
        });
      }
      if (payload.scope !== undefined && typeof payload.scope !== "string") {
        throw new McpOAuthError("invalid_token", "OAuth access token has an invalid scope claim", {
          diagnostic: { reason: "invalid_claim", claim: "scope" },
        });
      }

      const scopes = Object.freeze(Array.from(new Set((payload.scope ?? "").split(/\s+/).filter(Boolean))));
      const subject = payload.sub as string;
      if (!this.currentAllowedSubjects().includes(subject)) {
        throw new McpOAuthError("forbidden", "OAuth subject is not allowed");
      }
      const principal = Object.freeze({
        kind: "oauth" as const,
        issuer: provider.metadata.issuer,
        subject,
        clientId: clientId as string,
        resource: this.config.resourceUrl,
        scopes,
        expiresAt,
        readOnly: !scopes.includes("write:sui"),
      });
      if (!scopes.includes("read:sui")) {
        throw new McpOAuthError("insufficient_scope", "OAuth access token requires read:sui", undefined, principal);
      }

      return principal;
    } catch (error) {
      if (error instanceof McpOAuthError) throw error;
      throw new McpOAuthError(joseFailureKind(error), "OAuth access token verification failed", {
        cause: error,
        diagnostic: joseFailureDiagnostic(error),
      });
    }
  }

  assertPrincipalCurrent(principal: McpOAuthPrincipal) {
    const env = this.options.envProvider();
    const issuer = env.SUI_OIDC_ISSUER;
    const nowSeconds = Math.floor(this.options.now() / 1000);
    if (
      !issuer
      || !isSameIssuerTarget(issuer, this.config.configuredIssuer, this.options.allowInsecureUrlsForTests)
      || principal.resource !== this.config.resourceUrl
      || principal.expiresAt + CLOCK_TOLERANCE_SECONDS < nowSeconds
    ) {
      throw new McpOAuthError("invalid_token", "OAuth access token is no longer valid");
    }
    if (!this.currentAllowedSubjects().includes(principal.subject)) {
      throw new McpOAuthError("forbidden", "OAuth subject is no longer allowed");
    }
  }

  private currentAllowedSubjects() {
    return parseList(this.options.envProvider().SUI_OIDC_ALLOWED_SUBJECTS);
  }
}

export function createMcpOAuthService(options: CreateMcpOAuthServiceOptions): McpOAuthService | null {
  if (options.authMode === "disabled") {
    return null;
  }

  const env = options.env ?? process.env;
  const rawResource = env.SUI_MCP_OAUTH_RESOURCE_URL?.trim();
  if (!rawResource) {
    return null;
  }

  const allowInsecureUrlsForTests = options.allowInsecureUrlsForTests ?? false;
  const resource = assertUrl(rawResource, "SUI_MCP_OAUTH_RESOURCE_URL", allowInsecureUrlsForTests);
  if (resource.pathname !== "/mcp") {
    throw new Error("SUI_MCP_OAUTH_RESOURCE_URL path must be /mcp");
  }

  const configuredIssuer = env.SUI_OIDC_ISSUER?.trim();
  if (!configuredIssuer) {
    throw new Error("SUI_OIDC_ISSUER is required when MCP OAuth is enabled");
  }
  const issuer = assertUrl(configuredIssuer, "SUI_OIDC_ISSUER", allowInsecureUrlsForTests);
  if (parseList(env.SUI_OIDC_ALLOWED_SUBJECTS).length === 0) {
    throw new Error("SUI_OIDC_ALLOWED_SUBJECTS is required when MCP OAuth is enabled");
  }

  return new McpOAuthService(
    {
      resourceUrl: resource.href,
      metadataUrl: buildMetadataUrl(resource),
      configuredIssuer: issuer.href,
    },
    issuer,
    {
      allowInsecureUrlsForTests,
      now: options.now ?? Date.now,
      fetch: options.fetch ?? globalThis.fetch,
      envProvider: options.envProvider ?? (() => options.env ?? process.env),
    },
  );
}

export function oauthOwnerKey(principal: McpOAuthPrincipal) {
  const tuple = JSON.stringify(["oauth", principal.issuer, principal.subject, principal.clientId, principal.resource]);
  return `oauth:${createHash("sha256").update(tuple).digest("hex")}`;
}
