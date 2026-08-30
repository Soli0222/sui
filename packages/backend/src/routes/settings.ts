import {
  DASHBOARD_PERIOD_PRESETS,
  TRANSACTION_DEFAULT_PERIOD_PRESETS,
} from "@sui/shared";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError } from "../lib/http";
import { getUiSettings, updateUiSettings } from "../services/settings";

const updateUiSettingsSchema = z
  .object({
    dashboardDefaultPeriod: z.enum(DASHBOARD_PERIOD_PRESETS).optional(),
    transactionsDefaultPeriod: z.enum(TRANSACTION_DEFAULT_PERIOD_PRESETS).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required",
  });

export const settingsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      return c.json(await getUiSettings(prisma));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/", async (c) => {
    try {
      const patch = updateUiSettingsSchema.parse(await c.req.json());
      return c.json(await updateUiSettings(prisma, patch));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
