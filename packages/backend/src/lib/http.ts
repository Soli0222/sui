import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;

  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

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

  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status);
  }

  logger.error(
    {
      err: toLoggableError(error),
      method: c.req.method,
      path: c.req.path,
      "request-id": c.res.headers.get("x-request-id") ?? undefined,
    },
    "Unhandled route error",
  );

  return c.json({ error: "Internal server error" }, 500);
}

function toLoggableError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(`Non-error thrown: ${formatUnknownError(error)}`);
}

function formatUnknownError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
