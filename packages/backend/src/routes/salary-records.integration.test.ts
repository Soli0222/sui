import type { SalaryRecord } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createSalaryRecord } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("salary records routes", () => {
  it("returns non-deleted salary records ordered by paidOn desc", async () => {
    const active = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-03-15T00:00:00.000Z"),
      kind: "salary",
      name: "March",
      grossAmount: 400000,
      healthInsurance: 20000,
      pensionInsurance: 30000,
      employmentInsurance: 2000,
      incomeTax: 25000,
      residentTax: 15000,
      otherDeductions: 0,
    });
    const deleted = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-02-15T00:00:00.000Z"),
      kind: "salary",
      name: "Deleted",
      grossAmount: 100000,
      deletedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const bonus = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-06-15T00:00:00.000Z"),
      kind: "bonus",
      name: "Summer Bonus",
      grossAmount: 500000,
      incomeTax: 50000,
      residentTax: 20000,
    });

    const response = await client.get("/api/salary-records");
    const body = await parseJson<SalaryRecord[]>(response);

    expect(response.status).toBe(200);
    expect(body.map((record) => record.id)).toEqual([bonus.id, active.id]);
    expect(body.some((record) => record.id === deleted.id)).toBe(false);
    expect(body[0]?.paidOn).toBe("2026-06-15");
  });

  it("filters salary records by year", async () => {
    await createSalaryRecord(testPrisma, {
      paidOn: new Date("2025-12-20T00:00:00.000Z"),
      kind: "salary",
      name: "Previous year",
      grossAmount: 300000,
    });
    const current = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-01-05T00:00:00.000Z"),
      kind: "salary",
      name: "Current year",
      grossAmount: 400000,
    });

    const response = await client.get("/api/salary-records?year=2026");
    const body = await parseJson<SalaryRecord[]>(response);

    expect(response.status).toBe(200);
    expect(body.map((record) => record.id)).toEqual([current.id]);
  });

  it("filters salary records by the minimum supported year 0001", async () => {
    const withinYear = await createSalaryRecord(testPrisma, {
      paidOn: new Date("0001-06-15T00:00:00.000Z"),
      kind: "salary",
      name: "Year 1",
      grossAmount: 100,
    });
    const nextYear = await createSalaryRecord(testPrisma, {
      paidOn: new Date("0002-01-01T00:00:00.000Z"),
      kind: "salary",
      name: "Next year",
      grossAmount: 200,
    });

    const response = await client.get("/api/salary-records?year=0001");
    const body = await parseJson<SalaryRecord[]>(response);

    expect(response.status).toBe(200);
    expect(body.map((record) => record.id)).toEqual([withinYear.id]);
    expect(body.some((record) => record.id === nextYear.id)).toBe(false);
  });

  it("rejects invalid or out-of-range year queries", async () => {
    const wrongFormat = await client.get("/api/salary-records?year=2026-01");
    const zeroYear = await client.get("/api/salary-records?year=0000");
    const maxBoundary = await client.get("/api/salary-records?year=9999");

    expect(wrongFormat.status).toBe(400);
    expect(zeroYear.status).toBe(400);
    expect(maxBoundary.status).toBe(400);
    expect(await parseJson(wrongFormat)).toEqual({
      error: "year must be a supported 4-digit year",
    });
  });

  it("creates a salary record with derived fields", async () => {
    const response = await client.post("/api/salary-records", {
      paidOn: "2026-05-10",
      kind: "salary",
      name: "May",
      grossAmount: 350000,
      healthInsurance: 15000,
      pensionInsurance: 25000,
      employmentInsurance: 1000,
      incomeTax: 20000,
      residentTax: 12000,
      otherDeductions: 5000,
    });

    const created = await parseJson<SalaryRecord>(response);
    expect(response.status).toBe(201);
    expect(created.paidOn).toBe("2026-05-10");
    expect(created.kind).toBe("salary");
    expect(created.socialInsuranceTotal).toBe(41000);
    expect(created.netAmount).toBe(272000);

    const saved = await testPrisma.salaryRecord.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.paidOn.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(saved.grossAmount).toBe(350000);
    expect(saved.healthInsurance).toBe(15000);
  });

  it("allows negative net amount and omits deduction fields", async () => {
    const response = await client.post("/api/salary-records", {
      paidOn: "2026-07-01",
      grossAmount: 10000,
      incomeTax: 50000,
    });

    const created = await parseJson<SalaryRecord>(response);
    expect(response.status).toBe(201);
    expect(created.grossAmount).toBe(10000);
    expect(created.incomeTax).toBe(50000);
    expect(created.netAmount).toBe(-40000);
  });

  it("rejects invalid date and negative or out-of-range amounts", async () => {
    const invalidDate = await client.post("/api/salary-records", {
      paidOn: "2026-5-1",
      grossAmount: 100000,
    });
    const negativeAmount = await client.post("/api/salary-records", {
      paidOn: "2026-05-01",
      grossAmount: -100,
    });
    const fractionalAmount = await client.post("/api/salary-records", {
      paidOn: "2026-05-01",
      grossAmount: 100.5,
    });
    const tooLarge = await client.post("/api/salary-records", {
      paidOn: "2026-05-01",
      grossAmount: 2147483648,
    });

    expect(invalidDate.status).toBe(400);
    expect(negativeAmount.status).toBe(400);
    expect(fractionalAmount.status).toBe(400);
    expect(tooLarge.status).toBe(400);
  });

  it("rejects unknown fields in create payload", async () => {
    const response = await client.post("/api/salary-records", {
      paidOn: "2026-05-01",
      grossAmount: 100000,
      extra: 1,
    });
    expect(response.status).toBe(400);
  });

  it("partially updates a salary record", async () => {
    const record = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-04-15T00:00:00.000Z"),
      kind: "salary",
      name: "Before",
      grossAmount: 300000,
      healthInsurance: 10000,
    });

    const response = await client.patch(`/api/salary-records/${record.id}`, {
      grossAmount: 400000,
      incomeTax: 30000,
    });

    const updated = await parseJson<SalaryRecord>(response);
    expect(response.status).toBe(200);
    expect(updated.grossAmount).toBe(400000);
    expect(updated.healthInsurance).toBe(10000);
    expect(updated.incomeTax).toBe(30000);
    expect(updated.netAmount).toBe(360000);

    const saved = await testPrisma.salaryRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(saved.grossAmount).toBe(400000);
    expect(saved.name).toBe("Before");
  });

  it("rejects empty patch body", async () => {
    const record = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-04-15T00:00:00.000Z"),
      grossAmount: 300000,
    });

    const response = await client.patch(`/api/salary-records/${record.id}`, {});
    expect(response.status).toBe(400);
  });

  it("returns 404 when updating or deleting a missing record", async () => {
    const missingUpdate = await client.patch("/api/salary-records/11111111-1111-4111-a111-111111111111", {
      grossAmount: 1000,
    });
    const missingDelete = await client.delete("/api/salary-records/11111111-1111-4111-a111-111111111111");

    expect(missingUpdate.status).toBe(404);
    expect(missingDelete.status).toBe(404);
  });

  it("logically deletes a salary record", async () => {
    const record = await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-04-15T00:00:00.000Z"),
      grossAmount: 300000,
    });

    const response = await client.delete(`/api/salary-records/${record.id}`);
    expect(response.status).toBe(204);

    const saved = await testPrisma.salaryRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(saved.deletedAt).not.toBeNull();

    const list = await client.get("/api/salary-records");
    const body = await parseJson<SalaryRecord[]>(list);
    expect(body.some((item) => item.id === record.id)).toBe(false);
  });
});
