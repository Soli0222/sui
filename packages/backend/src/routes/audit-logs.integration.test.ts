import type { AuditLogsResponse } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { testPrisma } from "../test-helpers/db";

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

    const updateResponse = await client.put(`/api/accounts/${created.id}`, accountPayload("Main updated", 2000), {
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

  it("does not record failed state-changing requests", async () => {
    const response = await client.post("/api/accounts", {
      name: "",
      balance: 0,
      balanceOffset: 0,
      sortOrder: 1,
    }, {
      headers: { "x-sui-client": "mcp" },
    });

    expect(response.status).toBe(400);
    expect(await testPrisma.auditLog.count()).toBe(0);
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
});
