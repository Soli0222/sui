import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { ConflictError, handleRouteError, NotFoundError } from "./http";

async function routeErrorResponse(error: unknown) {
  const app = new Hono();
  app.get("/", (c) => handleRouteError(c, error));

  return app.request("/");
}

async function parseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function createZodError() {
  try {
    z.object({ name: z.string() }).parse({});
  } catch (error) {
    if (error instanceof ZodError) {
      return error;
    }
  }

  throw new Error("Expected ZodError");
}

describe("handleRouteError", () => {
  it("maps ZodError to 400 with validation details", async () => {
    const response = await routeErrorResponse(createZodError());

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toMatchObject({
      error: "Validation failed",
      details: expect.any(Object),
    });
  });

  it("maps NotFoundError to 404", async () => {
    const response = await routeErrorResponse(new NotFoundError("Missing resource"));

    expect(response.status).toBe(404);
    await expect(parseJson(response)).resolves.toEqual({ error: "Missing resource" });
  });

  it("maps ConflictError to 409", async () => {
    const response = await routeErrorResponse(new ConflictError("Already exists"));

    expect(response.status).toBe(409);
    await expect(parseJson(response)).resolves.toEqual({ error: "Already exists" });
  });

  it("maps raw Error to 500 without leaking the internal message", async () => {
    const response = await routeErrorResponse(new Error("database connection refused"));

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual({ error: "Internal server error" });
  });
});
