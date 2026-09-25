import type { AuditLogsResponse } from "@sui/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestApp, createTestClient, parseJson } from "../test-helpers/app";
import { testPrisma } from "../test-helpers/db";
import { createApiTokenRecord } from "../lib/auth";
import { prisma } from "../lib/db";
import { createAccount, createRecurringItem } from "../test-helpers/fixtures";

const client = createTestClient();

function accountPayload(name: string, balance = 1000) {
  return {
    name,
    balance,
    balanceOffset: 0,
    sortOrder: 1,
  };
}

describe("audit log routes", () => {
  it("records successful POST, PUT, and DELETE requests with client source", async () => {
    const createdResponse = await client.post("/api/accounts", accountPayload("Main"), {
      headers: {
        "x-sui-client": "mcp",
        "x-request-id": "req-create",
      },
    });
    const created = await parseJson<{ id: string }>(createdResponse);

    expect(createdResponse.status).toBe(201);

    const updateResponse = await client.put(`/api/accounts/${created.id}`, {
      name: "Main updated", balanceOffset: 0, sortOrder: 1,
    }, {
      headers: {
        "x-sui-client": "web",
        "x-request-id": "req-update",
      },
    });
    const deleteResponse = await client.delete(`/api/accounts/${created.id}`, {
      headers: {
        "x-sui-client": "mobile",
        "x-request-id": "req-delete",
      },
    });

    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(204);
    expect(await testPrisma.auditLog.count()).toBe(3);

    await expect(testPrisma.auditLog.findFirstOrThrow({
      where: { method: "POST", path: "/api/accounts" },
    })).resolves.toMatchObject({
      status: 201,
      clientSource: "mcp",
      requestId: "req-create",
      authKind: "disabled",
      subject: "disabled",
      authMode: "disabled",
    });
    await expect(testPrisma.auditLog.findFirstOrThrow({
      where: { method: "PUT", path: `/api/accounts/${created.id}` },
    })).resolves.toMatchObject({
      status: 200,
      clientSource: "web",
      requestId: "req-update",
    });
    await expect(testPrisma.auditLog.findFirstOrThrow({
      where: { method: "DELETE", path: `/api/accounts/${created.id}` },
    })).resolves.toMatchObject({
      status: 204,
      clientSource: "unknown",
      requestId: "req-delete",
    });
  });

  it("does not record GET requests", async () => {
    const response = await client.get("/api/accounts", {
      headers: { "x-sui-client": "web" },
    });

    expect(response.status).toBe(200);
    expect(await testPrisma.auditLog.count()).toBe(0);
  });

  it("records validation failures without request body or query string", async () => {
    const response = await client.post("/api/accounts", {
      name: "secret-in-body",
      balance: 0,
      balanceOffset: 0,
      sortOrder: "invalid",
    }, {
      headers: { "x-sui-client": "mcp" },
    });

    expect(response.status).toBe(400);
    const logs = await testPrisma.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 400, path: "/api/accounts", clientSource: "mcp" });
    expect(JSON.stringify(logs)).not.toContain("secret-in-body");
  });

  it("records failed GETs and 404s, but reading logs adds no successful GET entry", async () => {
    const missing = await client.get("/api/nonexistent?code=secret-query");
    expect(missing.status).toBe(404);
    const listed = await client.get("/api/audit-logs");
    expect(listed.status).toBe(200);
    const logs = await testPrisma.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 404, path: "/api/nonexistent" });
    expect(JSON.stringify(logs)).not.toContain("secret-query");
  });

  it("records a duplicate change as 409 and bounds long paths", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });
    const item = await createRecurringItem(testPrisma, {
      name: "Rent", accountId: account.id, startDate: new Date("2026-06-01T00:00:00.000Z"),
      amount: 80000, dayOfMonth: 1,
    });
    const path = `/api/recurring-items/${item.id}/amount-changes`;
    expect((await client.post(path, { effectiveFrom: "2026-07-01", amount: 1000 })).status).toBe(201);
    expect((await client.post(path, { effectiveFrom: "2026-07-01", amount: 2000 })).status).toBe(409);
    const tooLong = await client.get(`/api/${"x".repeat(400)}`);
    expect(tooLong.status).toBe(404);
    const logs = await testPrisma.auditLog.findMany();
    expect(logs).toContainEqual(expect.objectContaining({ status: 409, path }));
    expect(logs).toContainEqual(expect.objectContaining({ status: 404, path: `/api/${"x".repeat(295)}` }));
  });

  it("records unauthenticated, read-only and Origin failures with verified identity only", async () => {
    const secured = createTestClient(createTestApp({ authMode: "enabled" }));
    const unauthenticated = await secured.get("/api/accounts", {
      headers: { Authorization: "Bearer sui_tok_invalid" },
    });
    expect(unauthenticated.status).toBe(401);

    const { token, record } = await createApiTokenRecord("audit-readonly", true);
    const headers = { Authorization: `Bearer ${token}` };
    const readonly = await secured.post("/api/accounts", accountPayload("Blocked"), { headers });
    expect(readonly.status).toBe(403);
    const { token: writeToken, record: writeRecord } = await createApiTokenRecord("audit-origin");
    const rejectedOrigin = await secured.post("/api/accounts", accountPayload("Blocked"), {
      headers: { Authorization: `Bearer ${writeToken}`, Origin: "https://evil.example" },
    });
    expect(rejectedOrigin.status).toBe(403);

    const logs = await testPrisma.auditLog.findMany();
    expect(logs).toHaveLength(3);
    expect(logs).toContainEqual(expect.objectContaining({ status: 401, subject: null, authKind: null, apiTokenId: null }));
    expect(logs).toContainEqual(expect.objectContaining({ status: 403, authKind: "token", apiTokenId: record.id }));
    expect(logs).toContainEqual(expect.objectContaining({ status: 403, authKind: "token", apiTokenId: writeRecord.id }));
    expect(JSON.stringify(logs)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain(writeToken);
  });

  it("records unexpected 500 and keeps the response status when audit storage fails", async () => {
    const app = createTestApp();
    app.get("/api/audit-failure-test", () => { throw new Error("private error detail"); });
    const failed = await app.request("/api/audit-failure-test");
    expect(failed.status).toBe(500);
    const entry = await testPrisma.auditLog.findFirstOrThrow();
    expect(entry).toMatchObject({ status: 500, path: "/api/audit-failure-test" });
    expect(JSON.stringify(entry)).not.toContain("private error detail");

    const write = vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(new Error("audit DB unavailable"));
    try {
      const response = await app.request("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(accountPayload("Still succeeds")),
      });
      expect(response.status).toBe(201);
    } finally {
      write.mockRestore();
    }
  });

  it("returns paginated audit logs ordered by createdAt desc", async () => {
    await testPrisma.auditLog.create({
      data: {
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        method: "POST",
        path: "/api/accounts",
        status: 201,
        clientSource: "web",
        requestId: "req-1",
      },
    });
    await testPrisma.auditLog.create({
      data: {
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
        method: "PUT",
        path: "/api/accounts/account-id",
        status: 200,
        clientSource: "mcp",
        requestId: "req-2",
      },
    });
    await testPrisma.auditLog.create({
      data: {
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
        method: "DELETE",
        path: "/api/accounts/account-id",
        status: 204,
        clientSource: "unknown",
        requestId: null,
      },
    });

    const response = await client.get("/api/audit-logs?page=2&limit=2");
    const body = await parseJson<AuditLogsResponse>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
    });
    expect(body.items).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/accounts",
        clientSource: "web",
        requestId: "req-1",
      }),
    ]);
    expect(body.items[0]?.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("filters rows and count by status class", async () => {
    for (const status of [201, 400, 403, 500]) {
      await testPrisma.auditLog.create({
        data: { method: "POST", path: "/api/accounts", status, clientSource: "web" },
      });
    }
    const result = await client.get("/api/audit-logs?status=4xx&limit=1&page=2");
    const body = await parseJson<AuditLogsResponse>(result);
    expect(result.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBeGreaterThanOrEqual(400);
    expect(body.items[0]?.status).toBeLessThan(500);
  });
});
