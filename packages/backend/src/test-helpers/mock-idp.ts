import { OAuth2Server } from "oauth2-mock-server";

export interface MockIdp {
  issuerUrl: string;
  stop: () => Promise<void>;
}

export async function startMockIdp(claims: { sub: string; email?: string }): Promise<MockIdp> {
  const server = new OAuth2Server();
  await server.issuer.keys.generate("RS256");

  server.service.on("beforeTokenSigning", (token) => {
    token.payload.sub = claims.sub;
    if (claims.email) {
      token.payload.email = claims.email;
      token.payload.email_verified = true;
    }
  });

  await server.start(0, "localhost");

  if (!server.issuer.url) {
    throw new Error("Mock IdP did not start");
  }

  return {
    issuerUrl: server.issuer.url,
    stop: () => server.stop(),
  };
}
