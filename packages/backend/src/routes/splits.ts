import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError } from "../lib/http";
import { isDateString } from "../lib/dates";
import { listSplits } from "../services/splits";

const listQuerySchema = z
  .object({
    status: z.enum(["unsettled", "partial", "settled"]).optional(),
    personId: z.string().uuid().optional(),
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

export const splitsRoutes = new Hono().get("/", async (c) => {
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
});
