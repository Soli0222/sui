import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { AuthStatus, ApiTokenSummary, CreatedApiToken } from "@sui/shared";
import {
  createApiTokenRecord,
  createAuthSession,
  deleteAuthSession,
  deleteAuthSessionById,
  getAuthSessionByIdForSubject,
  isSecureCookie,
  listApiTokens,
  listAuthSessions,
  revokeApiToken,
  revokeAuthSessions,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  verifyApiToken,
  verifyAuthSession,
  cleanupExpiredSessions,
} from "../lib/auth";
import { handleRouteError } from "../lib/http";
import { logger } from "../lib/logger";
import { buildAuthorizationUrl, handleCallback, isOidcConfigured } from "../lib/oidc";

const FLOW_COOKIE_MAX_AGE_SECONDS = 10 * 60;

function getFrontendUrl() {
  const url = process.env.SUI_FRONTEND_URL;
  if (!url) return "/";
  return url.endsWith("/") ? url : `${url}/`;
}

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  readOnly: z.boolean().default(false),
});

function serializeApiToken(token: Awaited<ReturnType<typeof listApiTokens>>[number]): ApiTokenSummary {
  return {
    id: token.id,
    name: token.name,
    readOnly: token.readOnly,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
  };
}

function setAuthFlowCookie(c: Context, name: string, value: string) {
  setCookie(c, name, value, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/api/auth/callback",
    secure: isSecureCookie(c),
    maxAge: FLOW_COOKIE_MAX_AGE_SECONDS,
  });
}

function clearAuthFlowCookies(c: Context) {
  for (const name of ["sui_auth_state", "sui_auth_nonce", "sui_auth_pkce"]) {
    deleteCookie(c, name, { path: "/api/auth/callback" });
  }
}

function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

async function isAuthenticated(c: Context) {
  const bearer = c.req.header("Authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    const record = await verifyApiToken(token);
    if (record) {
      return true;
    }
  }

  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionToken) {
    const result = await verifyAuthSession(sessionToken);
    if (result) {
      if (result.extended) {
        setSessionCookie(c, sessionToken, result.session.expiresAt);
      }
      return true;
    }
  }

  return false;
}

export const authRoutes = new Hono()
  .get("/status", async (c) => {
    const authMode = c.get("authMode") ?? process.env.SUI_AUTH_MODE ?? "enabled";
    if (authMode === "disabled") {
      return c.json({ configured: false, authenticated: true });
    }

    const status: AuthStatus = {
      configured: isOidcConfigured(),
      authenticated: await isAuthenticated(c),
    };
    return c.json(status);
  })
  .get("/login", async (c) => {
    try {
      const { url, state, nonce, codeVerifier } = await buildAuthorizationUrl();
      setAuthFlowCookie(c, "sui_auth_state", state);
      setAuthFlowCookie(c, "sui_auth_nonce", nonce);
      setAuthFlowCookie(c, "sui_auth_pkce", codeVerifier);
      return c.redirect(url);
    } catch (error) {
      logger.warn({ err: error }, "Failed to build authorization URL");
      return c.redirect(`${getFrontendUrl()}?auth_error=oidc_discovery_failed`);
    }
  })
  .get("/callback", async (c) => {
    const state = getCookie(c, "sui_auth_state");
    const nonce = getCookie(c, "sui_auth_nonce");
    const codeVerifier = getCookie(c, "sui_auth_pkce");
    clearAuthFlowCookies(c);

    if (!state || !nonce || !codeVerifier) {
      logger.warn("OIDC callback rejected: missing flow cookies");
      return c.redirect(`${getFrontendUrl()}?auth_error=oidc_callback_failed`);
    }

    const currentUrl = new URL(c.req.url);
    const result = await handleCallback(currentUrl, state, nonce, codeVerifier);

    if (!result.success) {
      return c.redirect(`${getFrontendUrl()}?auth_error=${result.error}`);
    }

    await cleanupExpiredSessions();
    const userAgent = c.req.header("User-Agent") ?? undefined;
    const { token, session } = await createAuthSession({
      issuer: result.issuer,
      subject: result.subject,
      email: result.email,
      userAgent,
    });
    setSessionCookie(c, token, session.expiresAt);
    logger.info({ subject: result.subject }, "OIDC login succeeded");
    return c.redirect(getFrontendUrl());
  })
  .post("/logout", async (c) => {
    const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
    if (sessionToken) {
      await deleteAuthSession(sessionToken);
    }
    clearSessionCookie(c);
    logger.info("Session logged out");
    return c.body(null, 204);
  })
  .get("/tokens", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.kind !== "session") {
      return c.json({ error: "Session authentication required" }, 403);
    }

    const tokens = await listApiTokens();
    return c.json(tokens.map(serializeApiToken));
  })
  .post("/tokens", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.kind !== "session") {
      return c.json({ error: "Session authentication required" }, 403);
    }

    try {
      const body = createTokenSchema.parse(await c.req.json());
      const { token, record } = await createApiTokenRecord(body.name, body.readOnly);
      const response: CreatedApiToken = {
        id: record.id,
        name: record.name,
        readOnly: record.readOnly,
        token,
        lastUsedAt: null,
        createdAt: record.createdAt.toISOString(),
      };
      c.header("Cache-Control", "no-store");
      logger.info({ tokenId: record.id, name: record.name }, "API token created");
      return c.json(response, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/tokens/:id", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.kind !== "session") {
      return c.json({ error: "Session authentication required" }, 403);
    }

    const id = c.req.param("id");
    const record = await revokeApiToken(id);
    if (!record) {
      return c.json({ error: "Token not found" }, 404);
    }

    logger.info({ tokenId: id }, "API token revoked");
    return c.body(null, 204);
  })
  .get("/sessions", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.kind !== "session" || !auth.subject) {
      return c.json({ error: "Session authentication required" }, 403);
    }

    const sessions = await listAuthSessions(auth.subject);
    return c.json(
      sessions.map((session) => ({
        id: session.id,
        issuer: session.issuer,
        subject: session.subject,
        userAgent: session.userAgent,
        expiresAt: session.expiresAt.toISOString(),
        maxExpiresAt: session.maxExpiresAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
      })),
    );
  })
  .delete("/sessions", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.kind !== "session" || !auth.subject) {
      return c.json({ error: "Session authentication required" }, 403);
    }

    await revokeAuthSessions(auth.subject);
    clearSessionCookie(c);
    logger.info({ subject: auth.subject }, "All sessions revoked");
    return c.body(null, 204);
  })
  .delete("/sessions/:id", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.kind !== "session" || !auth.subject) {
      return c.json({ error: "Session authentication required" }, 403);
    }

    const id = c.req.param("id");
    const session = await getAuthSessionByIdForSubject(id, auth.subject);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await deleteAuthSessionById(session.id);
    logger.info({ sessionId: session.id, subject: auth.subject }, "Session revoked");
    return c.body(null, 204);
  });
