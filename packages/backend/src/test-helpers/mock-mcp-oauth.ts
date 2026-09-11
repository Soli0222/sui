import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export interface MockAccessTokenOptions {
  subject?: string;
  clientId?: string;
  audience?: string;
  issuer?: string;
  scope?: string;
  expiresInSeconds?: number;
  notBeforeSeconds?: number;
  issuedAtSeconds?: number;
  typ?: string;
  alg?: "RS256" | "PS256";
  jti?: string;
  omit?: Array<"sub" | "client_id" | "jti" | "iat" | "exp">;
}

export interface MockMcpOAuthProvider {
  issuerUrl: string;
  jwksUrl: string;
  signAccessToken: (options?: MockAccessTokenOptions) => Promise<string>;
  stop: () => Promise<void>;
}

export async function startMockMcpOAuthProvider(): Promise<MockMcpOAuthProvider> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const { privateKey: pssPrivateKey } = await generateKeyPair("PS256");
  const publicJwk = await exportJWK(publicKey);
  const kid = "test-key";
  let issuerUrl = "";
  let server: Server;

  await new Promise<void>((resolve) => {
    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/.well-known/openid-configuration") {
        response.end(JSON.stringify({ issuer: issuerUrl, jwks_uri: `${issuerUrl}/jwks` }));
        return;
      }
      if (request.url === "/jwks") {
        response.end(JSON.stringify({ keys: [{ ...publicJwk, kid, use: "sig", alg: "RS256" }] }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server!.address() as AddressInfo;
  issuerUrl = `http://127.0.0.1:${address.port}`;

  return {
    issuerUrl,
    jwksUrl: `${issuerUrl}/jwks`,
    async signAccessToken(options = {}) {
      const now = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
      const omit = new Set(options.omit ?? []);
      const payload: Record<string, unknown> = {
        scope: options.scope ?? "read:sui write:sui",
      };
      if (!omit.has("sub")) payload.sub = options.subject ?? "allowed-sub";
      if (!omit.has("client_id")) payload.client_id = options.clientId ?? "chatgpt-client";
      if (!omit.has("jti")) payload.jti = options.jti ?? crypto.randomUUID();

      let jwt = new SignJWT(payload)
        .setProtectedHeader({ alg: options.alg ?? "RS256", kid, typ: options.typ ?? "at+jwt" })
        .setIssuer(options.issuer ?? issuerUrl)
        .setAudience(options.audience ?? "https://sui.example.com/mcp");
      if (!omit.has("iat")) jwt = jwt.setIssuedAt(now);
      if (!omit.has("exp")) jwt = jwt.setExpirationTime(now + (options.expiresInSeconds ?? 3600));
      if (options.notBeforeSeconds !== undefined) jwt = jwt.setNotBefore(now + options.notBeforeSeconds);
      return jwt.sign(options.alg === "PS256" ? pssPrivateKey : privateKey);
    },
    stop: () => new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    }),
  };
}
