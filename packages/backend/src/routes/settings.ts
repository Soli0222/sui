import { updateUiSettingsSchema } from "../schemas/settings";
import { Hono } from "hono";
import { prisma } from "../lib/db";
import { handleRouteError } from "../lib/http";
import { getUiSettings, updateUiSettings } from "../services/settings";

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
