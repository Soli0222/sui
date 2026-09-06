import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { handleRouteError } from "../lib/http";
import {
  getSpending,
  getSpendingAiStatus,
  saveSpendingAi,
  inspectSpendingAi,
  spendingCommand,
  previewSpendingImport,
  reviewSpending,
} from "../services/spending";
import {
  spendingCommandSchema,
  spendingSettingsSchema,
} from "../services/spending-validation";
const aiRequest = z.object({
  ai: spendingSettingsSchema.shape.ai.unwrap(),
  apiKey: z.string().trim().min(1).max(10000).optional(),
});
const version = z.number().int().nonnegative();
export const spendingRoutes = new Hono()
  .use("*", bodyLimit({ maxSize: 8 * 1024 * 1024 }))
  .get("/ai/status", async (c) => {
    try {
      return c.json(await getSpendingAiStatus());
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/ai/config", async (c) => {
    try {
      const b = aiRequest
        .extend({
          version,
          apiKey: z.string().trim().min(1).max(10000).nullable().optional(),
        })
        .strict()
        .parse(await c.req.json());
      await saveSpendingAi(b.version, b.ai, b.apiKey);
      return c.json(await getSpendingAiStatus());
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/ai/models", async (c) => {
    try {
      const b = aiRequest.strict().parse(await c.req.json());
      return c.json(await inspectSpendingAi(b.ai, b.apiKey, false));
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .post("/ai/test", async (c) => {
    try {
      const b = aiRequest.strict().parse(await c.req.json());
      return c.json(await inspectSpendingAi(b.ai, b.apiKey, true));
    } catch (e) {
      return handleRouteError(c, e);
    }
  })
  .get("/", async (c) => {
    try {
      const month = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional()
        .parse(c.req.query("month"));
      return c.json(await getSpending(month));
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
          filename: z.string().min(1).max(200),
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional(),
        })
        .strict()
        .parse(await c.req.json());
      const preview = await previewSpendingImport(
        b.version,
        Buffer.from(b.base64, "base64"),
        b.filename,
        b.month,
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
