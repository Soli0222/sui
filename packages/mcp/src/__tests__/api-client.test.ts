import { describe, expect, it, vi } from "vitest";
import { SuiApiClient } from "../api-client";

describe("SuiApiClient", () => {
  it("returns parsed JSON for successful GET requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new SuiApiClient("http://example.test", fetchImpl);

    await expect(client.get("/api/dashboard")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(new URL("/api/dashboard", "http://example.test"), {
      method: "GET",
    });
  });

  it("throws API error messages from JSON responses", async () => {
    const client = new SuiApiClient(
      "http://example.test",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "boom" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(client.post("/api/accounts", { name: "main" })).rejects.toThrow("boom");
  });

  it("returns undefined for 204 responses", async () => {
    const client = new SuiApiClient(
      "http://example.test",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(client.post<void>("/api/accounts", {})).resolves.toBeUndefined();
  });

  it("falls back to HTTP status when the error body is not JSON", async () => {
    const client = new SuiApiClient(
      "http://example.test",
      vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })),
    );

    await expect(client.delete("/api/accounts/1")).rejects.toThrow("API error: 502");
  });
});
