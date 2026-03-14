import { afterAll, afterEach, beforeEach, vi } from "vitest";

vi.mock("../lib/db", async () => {
  const { testPrisma } = await import("./db");
  return { prisma: testPrisma };
});

beforeEach(async () => {
  const { resetDatabase } = await import("./db");
  await resetDatabase();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  const { testPrisma } = await import("./db");
  await testPrisma.$disconnect();
});
