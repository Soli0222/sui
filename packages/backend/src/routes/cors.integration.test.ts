import { describe, expect, it } from "vitest";
import { createTestApp, createTestClient, parseJson } from "../test-helpers/app";

function accountPayload(name: string) {
  return {
    name,
    balance: 12345,
    balanceOffset: 678,
    sortOrder: 1,
  };
}

describe("API CORS and Origin guard", () => {
  it("allows POST requests without an Origin header", async () => {
    const client = createTestClient();

    const response = await client.post("/api/accounts", accountPayload("No Origin"));

    expect(response.status).toBe(201);
  });

  it("allows POST requests when Origin host matches the request Host", async () => {
    const client = createTestClient();

    const response = await client.post("/api/accounts", accountPayload("Same Host"), {
      headers: {
        Host: "sui.example.com",
        Origin: "https://sui.example.com",
      },
    });

    expect(response.status).toBe(201);
  });

  it("rejects POST requests from untrusted origins", async () => {
    const client = createTestClient();

    const response = await client.post("/api/accounts", accountPayload("Untrusted"), {
      headers: {
        Host: "sui.example.com",
        Origin: "https://evil.example.com",
      },
    });

    expect(response.status).toBe(403);
    expect(await parseJson(response)).toEqual({ error: "Origin not allowed" });
  });

  it("allows configured origins and emits Access-Control-Allow-Origin", async () => {
    const client = createTestClient(
      createTestApp({ allowedOrigins: ["https://app.example.com"] }),
    );

    const response = await client.post("/api/accounts", accountPayload("Configured Origin"), {
      headers: {
        Host: "api.example.com",
        Origin: "https://app.example.com",
      },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("allows GET requests from untrusted origins without Access-Control-Allow-Origin", async () => {
    const client = createTestClient(
      createTestApp({ allowedOrigins: ["https://app.example.com"] }),
    );

    const response = await client.get("/api/accounts", {
      headers: {
        Host: "api.example.com",
        Origin: "https://evil.example.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
