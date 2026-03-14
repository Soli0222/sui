import type { Context } from "hono";
import { ZodError } from "zod";

export function badRequest(c: Context, message: string) {
  return c.json({ error: message }, 400);
}

export function notFound(c: Context, message = "Not found") {
  return c.json({ error: message }, 404);
}

export function handleRouteError(c: Context, error: unknown) {
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "Validation failed",
        details: error.flatten(),
      },
      400,
    );
  }

  if (error instanceof Error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ error: "Unexpected error" }, 500);
}

