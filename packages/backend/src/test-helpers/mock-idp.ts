import { OAuth2Server } from "oauth2-mock-server";

export interface MockIdp {
  issuerUrl: string;
  stop: () => Promise<void>;
  getLastRedirectUri: () => string | undefined;
  clearLastRedirectUri: () => void;
}

export async function startMockIdp(
  claims: { sub: string; email?: string },
  port = 0,
): Promise<MockIdp> {
  const server = new OAuth2Server();
  await server.issuer.keys.generate("RS256");

  let lastRedirectUri: string | undefined;

  server.service.on("beforeTokenSigning", (token, req) => {
    const body = req.body as { redirect_uri?: string };
    if (body.redirect_uri) {
      lastRedirectUri = body.redirect_uri;
    }

    token.payload.sub = claims.sub;
    if (claims.email) {
      token.payload.email = claims.email;
      token.payload.email_verified = true;
    }
  });

  await server.start(port, "localhost");

  if (!server.issuer.url) {
    throw new Error("Mock IdP did not start");
  }

  return {
    issuerUrl: server.issuer.url,
    stop: () => server.stop(),
    getLastRedirectUri: () => lastRedirectUri,
    clearLastRedirectUri: () => {
      lastRedirectUri = undefined;
    },
  };
}
