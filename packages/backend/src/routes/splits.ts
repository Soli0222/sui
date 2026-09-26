import { splitPayloadSchema } from "../schemas/splits";
import { uuidSchema } from "../schemas/fields";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { isDateString } from "../lib/dates";
import { createSplit, deleteSplit, getSplit, listSplits, updateSplit } from "../services/splits";

const listQuerySchema = z
  .object({
    status: z.enum(["unsettled", "partial", "settled"]).optional(),
    personId: uuidSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && !isDateString(value.from)) {
      ctx.addIssue({ code: "custom", message: "from must be YYYY-MM-DD", path: ["from"] });
    }
    if (value.to && !isDateString(value.to)) {
      ctx.addIssue({ code: "custom", message: "to must be YYYY-MM-DD", path: ["to"] });
    }
  });

const idParamSchema = z.object({ id: uuidSchema });

export const splitsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const query = listQuerySchema.parse({
        status: c.req.query("status"),
        personId: c.req.query("personId"),
        from: c.req.query("from"),
        to: c.req.query("to"),
      });
      const splits = await listSplits(prisma, query);
      return c.json(splits);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const payload = splitPayloadSchema.parse(await c.req.json());
      const split = await createSplit(prisma, payload);
      return c.json(split, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .get("/:id", async (c) => {
    try {
      const { id } = idParamSchema.parse({ id: c.req.param("id") });
      const split = await getSplit(prisma, id);
      if (!split) {
        return notFound(c, "Split not found");
      }
      return c.json(split);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const { id } = idParamSchema.parse({ id: c.req.param("id") });
      const payload = splitPayloadSchema.parse(await c.req.json());
      const split = await updateSplit(prisma, id, payload);
      return c.json(split);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const { id } = idParamSchema.parse({ id: c.req.param("id") });
      await deleteSplit(prisma, id);
      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
