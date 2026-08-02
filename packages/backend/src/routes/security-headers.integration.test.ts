import { describe, expect, it } from "vitest";
import { createTestClient } from "../test-helpers/app";

describe("security headers", () => {
  it("adds nosniff and CSP frame-ancestors to an API response", async () => {
    const client = createTestClient();

    const response = await client.get("/api/accounts");

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("adds HSTS when the request is behind an HTTPS reverse proxy", async () => {
    const client = createTestClient();

    const response = await client.get("/api/accounts", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("omits HSTS for plain HTTP", async () => {
    const client = createTestClient();

    const response = await client.get("/api/accounts");

    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });
});
