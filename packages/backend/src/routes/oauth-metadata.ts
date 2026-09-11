import { Hono } from "hono";
import { MCP_OAUTH_SCOPES, McpOAuthError, type McpOAuthService } from "../lib/mcp-oauth";

export function createOAuthMetadataRoutes(oauthService: McpOAuthService | null) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    if (!oauthService) {
      return c.json({ error: "Not Found" }, 404);
    }

    try {
      const provider = await oauthService.getProviderMetadata();
      return c.json({
        resource: oauthService.config.resourceUrl,
        authorization_servers: [provider.issuer],
        scopes_supported: MCP_OAUTH_SCOPES,
        bearer_methods_supported: ["header"],
      });
    } catch (error) {
      if (error instanceof McpOAuthError && error.kind === "rate_limited") {
        return c.json({ error: "Too many OAuth metadata requests" }, 429);
      }
      if (error instanceof McpOAuthError && error.kind === "unavailable") {
        return c.json({ error: "OAuth provider unavailable" }, 503);
      }
      return c.json({ error: "OAuth metadata unavailable" }, 503);
    }
  });

  return routes;
}
