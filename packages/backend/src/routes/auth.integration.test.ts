import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { resetOidcCache } from "../lib/oidc";
import { createTestClient, parseJson } from "../test-helpers/app";
import { startMockIdp } from "../test-helpers/mock-idp";
import { testPrisma } from "../test-helpers/db";
import { resetAuth } from "@sui/db/testing";

function parseSetCookies(response: Response) {
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookies: Record<string, string> = {};
  for (const value of values) {
    const [nameValue] = value.split(";");
    const [name, cookieValue] = nameValue.trim().split("=");
    if (name && cookieValue) {
      cookies[name] = decodeURIComponent(cookieValue);
    }
  }
  return cookies;
}

function buildCookieHeader(cookies: Record<string, string>) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function followAuthorizeRedirect(authorizeUrl: string, redirectUri: string) {
  const response = await fetch(authorizeUrl, { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("No redirect location from IdP authorize endpoint");
  }
  const callbackUrl = new URL(location, redirectUri);
  return callbackUrl;
}

describe("auth routes", () => {
  let idp: Awaited<ReturnType<typeof startMockIdp>>;

  beforeAll(async () => {
    idp = await startMockIdp({ sub: "allowed-sub", email: "allowed@example.com" });
    vi.stubEnv("SUI_AUTH_MODE", "enabled");
    vi.stubEnv("SUI_OIDC_ISSUER", idp.issuerUrl);
    vi.stubEnv("SUI_OIDC_CLIENT_ID", "test-client");
    vi.stubEnv("SUI_OIDC_CLIENT_SECRET", "test-secret");
    vi.stubEnv("SUI_OIDC_REDIRECT_URI", "http://localhost/api/auth/callback");
    vi.stubEnv("SUI_OIDC_ALLOWED_SUBJECTS", "allowed-sub");
    vi.stubEnv("SUI_OIDC_ALLOWED_EMAILS", "");
    resetOidcCache();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await idp.stop();
  });

  beforeEach(async () => {
    await resetAuth(testPrisma);
  });

  function buildClient() {
    return createTestClient(createApp({ authMode: "enabled", enableStaticFallback: false }));
  }

  it("returns auth status", async () => {
    const client = buildClient();
    const response = await client.get("/api/auth/status");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({ configured: true, authenticated: false });
  });

  it("redirects to IdP login and protects other routes", async () => {
    const client = buildClient();
    const login = await client.get("/api/auth/login");

    expect(login.status).toBe(302);
    const location = login.headers.get("location");
    expect(location).toContain(idp.issuerUrl);
    expect(location).toContain("response_type=code");
    expect(location).toContain("code_challenge=");

    const cookies = parseSetCookies(login);
    expect(cookies.sui_auth_state).toBeDefined();
    expect(cookies.sui_auth_nonce).toBeDefined();
    expect(cookies.sui_auth_pkce).toBeDefined();

    const protectedResponse = await client.get("/api/accounts");
    expect(protectedResponse.status).toBe(401);
  });

  it("completes OIDC callback and establishes a session", async () => {
    const client = buildClient();
    const login = await client.get("/api/auth/login");
    const location = login.headers.get("location");
    if (!location) throw new Error("missing login redirect");

    const cookies = parseSetCookies(login);
    const callbackUrl = await followAuthorizeRedirect(location, "http://localhost/api/auth/callback");
    const code = callbackUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    const callbackResponse = await client.get(`${callbackUrl.pathname}${callbackUrl.search}`, {
      headers: { Cookie: buildCookieHeader(cookies) },
    });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("/");

    const sessionCookies = parseSetCookies(callbackResponse);
    expect(sessionCookies.sui_session).toBeDefined();

    const status = await client.get("/api/auth/status", { headers: { Cookie: `sui_session=${sessionCookies.sui_session}` } });
    expect(await parseJson(status)).toEqual({ configured: true, authenticated: true });

    const accounts = await client.get("/api/accounts", { headers: { Cookie: `sui_session=${sessionCookies.sui_session}` } });
    expect(accounts.status).toBe(200);
  });

  it("rejects a user outside the allowlist", async () => {
    const otherIdp = await startMockIdp({ sub: "other-sub" });
    const originalIssuer = process.env.SUI_OIDC_ISSUER;
    process.env.SUI_OIDC_ISSUER = otherIdp.issuerUrl;
    resetOidcCache();

    try {
      const client = createTestClient(createApp({ authMode: "enabled", enableStaticFallback: false }));
      const login = await client.get("/api/auth/login");
      const location = login.headers.get("location");
      if (!location) throw new Error("missing login redirect");

      const cookies = parseSetCookies(login);
      const callbackUrl = await followAuthorizeRedirect(location, "http://localhost/api/auth/callback");

      const callbackResponse = await client.get(`${callbackUrl.pathname}${callbackUrl.search}`, {
        headers: { Cookie: buildCookieHeader(cookies) },
      });

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toContain("auth_error=allowlist_rejected");
    } finally {
      process.env.SUI_OIDC_ISSUER = originalIssuer;
      resetOidcCache();
      await otherIdp.stop();
    }
  });

  it("rejects an invalid state during callback", async () => {
    const client = buildClient();
    const login = await client.get("/api/auth/login");
    const location = login.headers.get("location");
    if (!location) throw new Error("missing login redirect");

    const cookies = parseSetCookies(login);
    cookies.sui_auth_state = "invalid";
    const callbackUrl = await followAuthorizeRedirect(location, "http://localhost/api/auth/callback");

    const callbackResponse = await client.get(`${callbackUrl.pathname}${callbackUrl.search}`, {
      headers: { Cookie: buildCookieHeader(cookies) },
    });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toContain("auth_error=");
  });

  it("issues, uses, and revokes API tokens", async () => {
    const client = buildClient();
    const login = await client.get("/api/auth/login");
    const location = login.headers.get("location");
    if (!location) throw new Error("missing login redirect");

    const cookies = parseSetCookies(login);
    const callbackUrl = await followAuthorizeRedirect(location, "http://localhost/api/auth/callback");
    const callbackResponse = await client.get(`${callbackUrl.pathname}${callbackUrl.search}`, {
      headers: { Cookie: buildCookieHeader(cookies) },
    });

    const sessionCookies = parseSetCookies(callbackResponse);
    const sessionCookie = `sui_session=${sessionCookies.sui_session}`;

    const createResponse = await client.post(
      "/api/auth/tokens",
      { name: "test-token", readOnly: false },
      { headers: { Cookie: sessionCookie } },
    );
    expect(createResponse.status).toBe(201);
    const created = await parseJson<{ token: string; id: string }>(createResponse);

    const accounts = await client.get("/api/accounts", { headers: { Authorization: `Bearer ${created.token}` } });
    expect(accounts.status).toBe(200);

    const postAccount = await client.post(
      "/api/accounts",
      { name: "Test", balance: 0, balanceOffset: 0, sortOrder: 0 },
      { headers: { Authorization: `Bearer ${created.token}` } },
    );
    expect(postAccount.status).toBe(201);

    const revoke = await client.delete(`/api/auth/tokens/${created.id}`, { headers: { Cookie: sessionCookie } });
    expect(revoke.status).toBe(204);

    const afterRevoke = await client.get("/api/accounts", { headers: { Authorization: `Bearer ${created.token}` } });
    expect(afterRevoke.status).toBe(401);
  });

  it("enforces read-only token restrictions", async () => {
    const client = buildClient();
    const login = await client.get("/api/auth/login");
    const location = login.headers.get("location");
    if (!location) throw new Error("missing login redirect");

    const cookies = parseSetCookies(login);
    const callbackUrl = await followAuthorizeRedirect(location, "http://localhost/api/auth/callback");
    const callbackResponse = await client.get(`${callbackUrl.pathname}${callbackUrl.search}`, {
      headers: { Cookie: buildCookieHeader(cookies) },
    });

    const sessionCookies = parseSetCookies(callbackResponse);
    const sessionCookie = `sui_session=${sessionCookies.sui_session}`;

    const createResponse = await client.post(
      "/api/auth/tokens",
      { name: "readonly-token", readOnly: true },
      { headers: { Cookie: sessionCookie } },
    );
    const created = await parseJson<{ token: string }>(createResponse);

    const accounts = await client.get("/api/accounts", { headers: { Authorization: `Bearer ${created.token}` } });
    expect(accounts.status).toBe(200);

    const post = await client.post(
      "/api/accounts",
      { name: "Test", balance: 0, balanceOffset: 0, sortOrder: 0 },
      { headers: { Authorization: `Bearer ${created.token}` } },
    );
    expect(post.status).toBe(403);
  });

  it("requires session authentication for token management", async () => {
    const client = buildClient();
    const createResponse = await client.post("/api/auth/tokens", { name: "no-session" });
    expect(createResponse.status).toBe(401);
  });

  it("logs out and invalidates the session", async () => {
    const client = buildClient();
    const login = await client.get("/api/auth/login");
    const location = login.headers.get("location");
    if (!location) throw new Error("missing login redirect");

    const cookies = parseSetCookies(login);
    const callbackUrl = await followAuthorizeRedirect(location, "http://localhost/api/auth/callback");
    const callbackResponse = await client.get(`${callbackUrl.pathname}${callbackUrl.search}`, {
      headers: { Cookie: buildCookieHeader(cookies) },
    });

    const sessionCookies = parseSetCookies(callbackResponse);
    const sessionCookie = `sui_session=${sessionCookies.sui_session}`;

    const before = await client.get("/api/accounts", { headers: { Cookie: sessionCookie } });
    expect(before.status).toBe(200);

    const logout = await client.post("/api/auth/logout", undefined, { headers: { Cookie: sessionCookie } });
    expect(logout.status).toBe(204);

    const after = await client.get("/api/accounts", { headers: { Cookie: sessionCookie } });
    expect(after.status).toBe(401);
  });

  it("respects disabled auth mode", async () => {
    vi.stubEnv("SUI_AUTH_MODE", "disabled");
    resetOidcCache();
    const client = createTestClient(createApp({ authMode: "disabled", enableStaticFallback: false }));

    const status = await client.get("/api/auth/status");
    expect(status.status).toBe(200);
    expect(await parseJson(status)).toEqual({ configured: false, authenticated: true });

    const accounts = await client.get("/api/accounts");
    expect(accounts.status).toBe(200);

    vi.stubEnv("SUI_AUTH_MODE", "enabled");
  });
});
