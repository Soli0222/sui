import * as client from "openid-client";
import { logger } from "./logger";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedSubjects: string[];
  allowedEmails: string[];
  cookieSecure?: string;
}

let cachedConfig: client.Configuration | null = null;
let cachedOidcEnv: OidcConfig | null = null;

function parseList(value: string | undefined) {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

export function loadOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.SUI_OIDC_ISSUER;
  const clientId = env.SUI_OIDC_CLIENT_ID;
  const clientSecret = env.SUI_OIDC_CLIENT_SECRET;
  const redirectUri = env.SUI_OIDC_REDIRECT_URI;
  const allowedSubjects = parseList(env.SUI_OIDC_ALLOWED_SUBJECTS);
  const allowedEmails = parseList(env.SUI_OIDC_ALLOWED_EMAILS);

  if (!issuer || !clientId || !clientSecret || !redirectUri || (allowedSubjects.length === 0 && allowedEmails.length === 0)) {
    return null;
  }

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    allowedSubjects,
    allowedEmails,
    cookieSecure: env.SUI_COOKIE_SECURE,
  };
}

export function isOidcConfigured(env: NodeJS.ProcessEnv = process.env) {
  return loadOidcConfig(env) !== null;
}

export function resetOidcCache() {
  cachedConfig = null;
  cachedOidcEnv = null;
}

export async function getOidcClientConfiguration(): Promise<{ config: client.Configuration; oidc: OidcConfig }> {
  const oidc = loadOidcConfig();
  if (!oidc) {
    throw new Error("OIDC is not configured");
  }

  if (cachedConfig && cachedOidcEnv && JSON.stringify(cachedOidcEnv) === JSON.stringify(oidc)) {
    return { config: cachedConfig, oidc: cachedOidcEnv };
  }

  try {
    const issuerUrl = new URL(oidc.issuer);
    const config = await client.discovery(
      issuerUrl,
      oidc.clientId,
      { client_secret: oidc.clientSecret },
      undefined,
      { execute: issuerUrl.protocol === "http:" ? [client.allowInsecureRequests] : undefined },
    );
    cachedConfig = config;
    cachedOidcEnv = oidc;
    return { config, oidc };
  } catch (error) {
    logger.warn({ err: error }, "OIDC discovery failed");
    throw new Error("OIDC discovery failed", { cause: error });
  }
}

export interface AuthorizationUrlResult {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function buildAuthorizationUrl(): Promise<AuthorizationUrlResult> {
  const { config, oidc } = await getOidcClientConfiguration();

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const parameters: Record<string, string> = {
    redirect_uri: oidc.redirectUri,
    scope: "openid email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  };

  if (!config.serverMetadata().supportsPKCE()) {
    delete parameters.code_challenge;
    delete parameters.code_challenge_method;
  }

  const url = client.buildAuthorizationUrl(config, parameters);
  return { url: url.href, state, nonce, codeVerifier };
}

export interface CallbackResult {
  success: true;
  subject: string;
  email?: string;
}

export interface CallbackFailure {
  success: false;
  error: string;
}

export type CallbackOutcome = CallbackResult | CallbackFailure;

export async function handleCallback(currentUrl: URL, state: string, nonce: string, codeVerifier: string): Promise<CallbackOutcome> {
  let config: client.Configuration;
  let oidc: OidcConfig;
  try {
    ({ config, oidc } = await getOidcClientConfiguration());
  } catch {
    return { success: false, error: "oidc_discovery_failed" };
  }

  try {
    const tokens = await client.authorizationCodeGrant(
      config,
      currentUrl,
      {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
      },
    );

    const claims = tokens.claims();
    if (!claims?.sub) {
      return { success: false, error: "invalid_id_token" };
    }

    const subject = claims.sub;
    if (oidc.allowedSubjects.length > 0 && oidc.allowedSubjects.includes(subject)) {
      return { success: true, subject, email: typeof claims.email === "string" ? claims.email : undefined };
    }

    if (oidc.allowedEmails.length > 0 && claims.email_verified === true && typeof claims.email === "string") {
      const email = claims.email.toLowerCase();
      const normalizedAllowed = oidc.allowedEmails.map((entry) => entry.toLowerCase());
      if (normalizedAllowed.includes(email)) {
        return { success: true, subject, email };
      }
    }

    logger.warn({ subject }, "OIDC login rejected: user not in allowlist");
    return { success: false, error: "allowlist_rejected" };
  } catch (error) {
    logger.warn({ err: error }, "OIDC callback failed");
    return { success: false, error: "oidc_callback_failed" };
  }
}
