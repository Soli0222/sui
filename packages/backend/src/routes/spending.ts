import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { handleRouteError } from "../lib/http";
import {
  getSpending,
  spendingCommand,
  previewSpendingImport,
  reviewSpending,
} from "../services/spending";
import {
  spendingCommandSchema,
  spendingDate,
} from "../services/spending-validation";
const version = z.number().int().nonnegative();
export const spendingRoutes = new Hono()
  .use("*", bodyLimit({ maxSize: 8 * 1024 * 1024 }))
  .get("/", async (c) => {
    try {
      return c.json(await getSpending());
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/commands", async (c) => {
    try {
      const body = z
        .object({ version, command: spendingCommandSchema })
        .strict()
        .parse(await c.req.json());
      await spendingCommand(body.version, body.command);
      return c.json(await getSpending());
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/imports/preview", async (c) => {
    try {
      const b = z
        .object({
          version,
          base64: z
            .string()
            .max(7 * 1024 * 1024)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
          encoding: z.enum(["utf-8", "shift_jis"]),
          filename: z.string().min(1).max(200),
          from: spendingDate,
          to: spendingDate,
        })
        .refine((b) => b.from <= b.to)
        .parse(await c.req.json());
      const preview = await previewSpendingImport(
        b.version,
        Buffer.from(b.base64, "base64"),
        b.encoding,
        b.filename,
        b.from,
        b.to,
      );
      return c.json({ preview, state: await getSpending() });
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/:id/review", async (c) => {
    try {
      const b = z
        .object({ version })
        .strict()
        .parse(await c.req.json());
      return c.json(await reviewSpending(b.version, c.req.param("id")));
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/:id/override", async (c) => {
    try {
      const b = z
        .object({ version, reason: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(await c.req.json());
      return c.json(
        await reviewSpending(b.version, c.req.param("id"), b.reason),
      );
    } catch (e) {
      return handleRouteError(c, e);
    }
  });
