import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpOAuthService, oauthOwnerKey } from "./mcp-oauth";
import { startMockMcpOAuthProvider, type MockMcpOAuthProvider } from "../test-helpers/mock-mcp-oauth";

const RESOURCE = "https://sui.example.com/mcp";

describe("MCP OAuth configuration", () => {
  it("is disabled without a resource URL and skips invalid settings when auth is disabled", () => {
    expect(createMcpOAuthService({ authMode: "enabled", env: {} })).toBeNull();
    expect(createMcpOAuthService({
      authMode: "disabled",
      env: { SUI_MCP_OAUTH_RESOURCE_URL: "not a url" },
    })).toBeNull();
  });

  it.each([
    [{ SUI_MCP_OAUTH_RESOURCE_URL: "http://sui.example.com/mcp", SUI_OIDC_ISSUER: "https://issuer.example.com", SUI_OIDC_ALLOWED_SUBJECTS: "sub" }, "must use HTTPS"],
    [{ SUI_MCP_OAUTH_RESOURCE_URL: "https://sui.example.com/other", SUI_OIDC_ISSUER: "https://issuer.example.com", SUI_OIDC_ALLOWED_SUBJECTS: "sub" }, "path must be /mcp"],
    [{ SUI_MCP_OAUTH_RESOURCE_URL: "https://sui.example.com/mcp?x=1", SUI_OIDC_ISSUER: "https://issuer.example.com", SUI_OIDC_ALLOWED_SUBJECTS: "sub" }, "must not contain"],
    [{ SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE, SUI_OIDC_ALLOWED_SUBJECTS: "sub" }, "SUI_OIDC_ISSUER is required"],
    [{ SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE, SUI_OIDC_ISSUER: "https://issuer.example.com", SUI_OIDC_ALLOWED_SUBJECTS: "" }, "SUI_OIDC_ALLOWED_SUBJECTS is required"],
  ])("rejects incomplete or invalid configuration", (env, message) => {
    expect(() => createMcpOAuthService({ authMode: "enabled", env })).toThrow(message);
  });
});

describe("MCP OAuth access tokens", () => {
  let provider: MockMcpOAuthProvider;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    provider = await startMockMcpOAuthProvider();
    env = {
      SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE,
      SUI_OIDC_ISSUER: provider.issuerUrl,
      SUI_OIDC_ALLOWED_SUBJECTS: "allowed-sub",
    };
  });

  afterAll(async () => {
    await provider.stop();
  });

  function service() {
    return createMcpOAuthService({
      authMode: "enabled",
      env,
      allowInsecureUrlsForTests: true,
    })!;
  }

  it("discovers the canonical issuer and verifies an RFC 9068 access token", async () => {
    const oauth = service();
    expect(await oauth.getProviderMetadata()).toEqual({
      issuer: provider.issuerUrl,
      jwksUri: provider.jwksUrl,
    });

    const principal = await oauth.verifyAccessToken(await provider.signAccessToken({ audience: RESOURCE }));
    expect(principal).toMatchObject({
      kind: "oauth",
      issuer: provider.issuerUrl,
      subject: "allowed-sub",
      clientId: "chatgpt-client",
      resource: RESOURCE,
      scopes: ["read:sui", "write:sui"],
      readOnly: false,
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
  });

  it("derives the same owner key across token refresh and separates principals", async () => {
    const oauth = service();
    const first = await oauth.verifyAccessToken(await provider.signAccessToken({ audience: RESOURCE, jti: "one" }));
    const refreshed = await oauth.verifyAccessToken(await provider.signAccessToken({ audience: RESOURCE, jti: "two", scope: "read:sui" }));
    const otherClient = await oauth.verifyAccessToken(await provider.signAccessToken({ audience: RESOURCE, clientId: "other", jti: "three" }));

    expect(oauthOwnerKey(first)).toBe(oauthOwnerKey(refreshed));
    expect(oauthOwnerKey(first)).not.toBe(oauthOwnerKey(otherClient));
    expect(refreshed.readOnly).toBe(true);
  });

  it.each([
    [{ audience: "https://other.example.com/mcp" }, "invalid_token"],
    [{ issuer: "https://other.example.com/" }, "invalid_token"],
    [{ typ: "JWT" }, "invalid_token"],
    [{ alg: "PS256" }, "invalid_token"],
    [{ expiresInSeconds: -60 }, "invalid_token"],
    [{ notBeforeSeconds: 60 }, "invalid_token"],
    [{ issuedAtSeconds: Math.floor(Date.now() / 1000) + 60 }, "invalid_token"],
    [{ omit: ["client_id"] }, "invalid_token"],
    [{ omit: ["jti"] }, "invalid_token"],
    [{ scope: "write:sui unknown" }, "insufficient_scope"],
    [{ subject: "denied-sub" }, "forbidden"],
  ] as const)("rejects invalid or unauthorized token variants", async (overrides, kind) => {
    await expect(service().verifyAccessToken(await provider.signAccessToken({
      audience: RESOURCE,
      ...overrides,
      omit: "omit" in overrides ? [...overrides.omit] : undefined,
    }))).rejects.toMatchObject({ kind });
  });

  it("does not accept a token signed by an unconfigured issuer key", async () => {
    const other = await startMockMcpOAuthProvider();
    try {
      const token = await other.signAccessToken({ issuer: provider.issuerUrl, audience: RESOURCE });
      await expect(service().verifyAccessToken(token)).rejects.toMatchObject({ kind: "invalid_token" });
    } finally {
      await other.stop();
    }
  });

  it("rechecks expiry and the current subject allowlist for internal API calls", async () => {
    let now = Date.now();
    const dynamicEnv = { ...env };
    const oauth = createMcpOAuthService({
      authMode: "enabled",
      env: dynamicEnv,
      envProvider: () => dynamicEnv,
      allowInsecureUrlsForTests: true,
      now: () => now,
    })!;
    const principal = await oauth.verifyAccessToken(await provider.signAccessToken({ audience: RESOURCE }));

    dynamicEnv.SUI_OIDC_ALLOWED_SUBJECTS = "other-sub";
    expect(() => oauth.assertPrincipalCurrent(principal)).toThrow(expect.objectContaining({ kind: "forbidden" }));

    dynamicEnv.SUI_OIDC_ALLOWED_SUBJECTS = "allowed-sub";
    now = (principal.expiresAt + 10) * 1000;
    expect(() => oauth.assertPrincipalCurrent(principal)).toThrow(expect.objectContaining({ kind: "invalid_token" }));
  });

  it("coalesces concurrent discovery and rejects mismatched discovery metadata", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return Response.json({ issuer: "https://issuer.example.com/", jwks_uri: "https://issuer.example.com/jwks" });
    };
    const oauth = createMcpOAuthService({
      authMode: "enabled",
      env: {
        SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE,
        SUI_OIDC_ISSUER: "https://issuer.example.com",
        SUI_OIDC_ALLOWED_SUBJECTS: "sub",
      },
      fetch,
    })!;
    await Promise.all([oauth.getProviderMetadata(), oauth.getProviderMetadata()]);
    expect(calls).toBe(1);

    const mismatched = createMcpOAuthService({
      authMode: "enabled",
      env: {
        SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE,
        SUI_OIDC_ISSUER: "https://issuer.example.com",
        SUI_OIDC_ALLOWED_SUBJECTS: "sub",
      },
      fetch: async () => Response.json({ issuer: "https://evil.example.com", jwks_uri: "https://evil.example.com/jwks" }),
    })!;
    await expect(mismatched.getProviderMetadata()).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("briefly caches discovery failures", async () => {
    let calls = 0;
    let now = 1_000;
    const oauth = createMcpOAuthService({
      authMode: "enabled",
      env: {
        SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE,
        SUI_OIDC_ISSUER: "https://issuer.example.com",
        SUI_OIDC_ALLOWED_SUBJECTS: "sub",
      },
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
      now: () => now,
    })!;

    await expect(oauth.getProviderMetadata()).rejects.toMatchObject({ kind: "unavailable" });
    await expect(oauth.getProviderMetadata()).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(1);

    now += 5_001;
    await expect(oauth.getProviderMetadata()).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(2);
  });

  it("limits OAuth work before provider discovery and token verification", async () => {
    const limitedEnv = {
      SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE,
      SUI_OIDC_ISSUER: "https://issuer.example.com",
      SUI_OIDC_ALLOWED_SUBJECTS: "sub",
      SUI_MCP_OAUTH_MAX_REQUESTS_PER_MINUTE: "2",
      SUI_MCP_OAUTH_MAX_CONCURRENT_REQUESTS: "1",
    };
    let releaseFetch!: () => void;
    const fetchBlocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const oauth = createMcpOAuthService({
      authMode: "enabled",
      env: limitedEnv,
      fetch: async () => {
        await fetchBlocked;
        return new Response(null, { status: 503 });
      },
    })!;

    const first = oauth.getProviderMetadata();
    await expect(oauth.verifyAccessToken("not-a-jwt")).rejects.toMatchObject({ kind: "unavailable" });
    releaseFetch();
    await expect(first).rejects.toMatchObject({ kind: "unavailable" });
    await expect(oauth.verifyAccessToken("not-a-jwt")).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("classifies JWKS network failures as temporary verification unavailability", async () => {
    const issuer = "https://issuer.example.com";
    const oauth = createMcpOAuthService({
      authMode: "enabled",
      env: {
        SUI_MCP_OAUTH_RESOURCE_URL: RESOURCE,
        SUI_OIDC_ISSUER: issuer,
        SUI_OIDC_ALLOWED_SUBJECTS: "allowed-sub",
      },
      fetch: async (input) => {
        if (String(input).endsWith("/.well-known/openid-configuration")) {
          return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
        }
        throw new TypeError("network unavailable");
      },
    })!;
    const signed = await provider.signAccessToken({ issuer, audience: RESOURCE });
    await expect(oauth.verifyAccessToken(signed)).rejects.toMatchObject({ kind: "unavailable" });
  });
});
