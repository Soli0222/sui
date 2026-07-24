import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type McpAuthMode = "token" | "oauth" | "token+oauth" | "disabled";

export interface McpAuthEnv {
  SUI_MCP_AUTH_MODE?: string;
  SUI_MCP_AUTH_TOKEN?: string;
  SUI_MCP_OAUTH_ISSUER?: string;
  SUI_MCP_OAUTH_AUDIENCE?: string;
  SUI_MCP_OAUTH_ALLOWED_SUBJECTS?: string;
  SUI_MCP_RESOURCE_URL?: string;
}

export function parseMcpAuthMode(value: string | undefined): McpAuthMode {
  if (value === "token" || value === "oauth" || value === "token+oauth" || value === "disabled") {
    return value;
  }
  return "token";
}

export function getMcpAuthMode(env: NodeJS.ProcessEnv = process.env): McpAuthMode {
  return parseMcpAuthMode(env.SUI_MCP_AUTH_MODE);
}

export function getMcpAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    mode: getMcpAuthMode(env),
    tokens: env.SUI_MCP_AUTH_TOKEN?.split(",").map((token) => token.trim()).filter(Boolean) ?? [],
    oauthIssuer: env.SUI_MCP_OAUTH_ISSUER,
    oauthAudience: env.SUI_MCP_OAUTH_AUDIENCE,
    oauthAllowedSubjects: env.SUI_MCP_OAUTH_ALLOWED_SUBJECTS?.split(",").map((sub) => sub.trim()).filter(Boolean) ?? [],
    resourceUrl: env.SUI_MCP_RESOURCE_URL,
  };
}

export function isMcpAuthConfigured(config: ReturnType<typeof getMcpAuthConfig>) {
  if (config.mode === "disabled") return true;
  if (config.mode === "token" || config.mode === "token+oauth") {
    return config.tokens.length > 0;
  }
  if (config.mode === "oauth") {
    return Boolean(config.oauthIssuer) && Boolean(config.oauthAudience) && Boolean(config.resourceUrl);
  }
  return false;
}

function getResourceMetadataUrl(resourceUrl: string) {
  const base = resourceUrl.endsWith("/") ? resourceUrl.slice(0, -1) : resourceUrl;
  return `${base}/.well-known/oauth-protected-resource`;
}

export function buildProtectedResourceMetadata(resourceUrl: string, issuer: string) {
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
  };
}

export function buildWwwAuthenticateHeader(config: ReturnType<typeof getMcpAuthConfig>) {
  if (config.mode === "oauth" || (config.mode === "token+oauth" && config.resourceUrl && config.oauthIssuer)) {
    const metadataUrl = getResourceMetadataUrl(config.resourceUrl ?? "");
    return `Bearer resource_metadata="${metadataUrl}"`;
  }
  return "Bearer";
}

function compareToken(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

async function verifyStaticToken(config: ReturnType<typeof getMcpAuthConfig>, authorization: string | undefined) {
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return false;
  }
  const token = authorization.slice(7).trim();
  for (const expected of config.tokens) {
    if (compareToken(token, expected)) {
      return true;
    }
  }
  return false;
}

let jwksUrlCache: string | null = null;

async function resolveJwksUrl(issuer: string) {
  if (jwksUrlCache) {
    return jwksUrlCache;
  }

  const wellKnown = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  try {
    const response = await fetch(wellKnown);
    if (response.ok) {
      const metadata = (await response.json()) as { jwks_uri?: string };
      if (metadata.jwks_uri) {
        jwksUrlCache = metadata.jwks_uri;
        return jwksUrlCache;
      }
    }
  } catch {
    // fall back to default JWKS path
  }

  const fallback = `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
  jwksUrlCache = fallback;
  return fallback;
}

async function verifyOAuthToken(config: ReturnType<typeof getMcpAuthConfig>, authorization: string | undefined) {
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return false;
  }
  if (!config.oauthIssuer || !config.oauthAudience) {
    return false;
  }

  const token = authorization.slice(7).trim();
  try {
    const jwksUrl = await resolveJwksUrl(config.oauthIssuer);
    const JWKS = createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: config.oauthIssuer,
      audience: config.oauthAudience,
    });

    if (config.oauthAllowedSubjects.length > 0 && typeof payload.sub === "string") {
      if (!config.oauthAllowedSubjects.includes(payload.sub)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export async function verifyMcpRequest(
  config: ReturnType<typeof getMcpAuthConfig>,
  authorization: string | undefined,
): Promise<boolean> {
  if (config.mode === "disabled") {
    return true;
  }

  if (config.mode === "token") {
    return verifyStaticToken(config, authorization);
  }

  if (config.mode === "oauth") {
    return verifyOAuthToken(config, authorization);
  }

  if (config.mode === "token+oauth") {
    if (await verifyStaticToken(config, authorization)) {
      return true;
    }
    return verifyOAuthToken(config, authorization);
  }

  return false;
}
