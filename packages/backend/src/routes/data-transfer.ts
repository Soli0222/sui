import type { DataExportResponse } from "@sui/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError } from "../lib/http";
import { importPayloadSchema, FORMAT_VERSION } from "../schemas/data-transfer";
import { buildExportData, replaceAllData } from "../services/data-transfer";

export const dataTransferRoutes = new Hono()
  .get("/export", async (c) => {
    c.header("Cache-Control", "private, no-store");
    try {
      const payload: DataExportResponse = {
        formatVersion: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        data: await prisma.$transaction(tx => buildExportData(tx), {isolationLevel: "RepeatableRead"}),
      };

      c.header("Content-Disposition", `attachment; filename="sui-export-${new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "")}.json"`);
      return c.json(payload);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post(
    "/import",
    bodyLimit({
      maxSize: 20 * 1024 * 1024,
      onError: (c) => c.json({ error: "Payload too large" }, 413),
    }),
    async (c) => {
      try {
        const payload = importPayloadSchema.parse(await c.req.json());
        if (payload.mode !== "replace") {
          return badRequest(c, 'mode must be "replace"');
        }
        if (payload.formatVersion !== FORMAT_VERSION) {
          return badRequest(c, `formatVersion must be ${FORMAT_VERSION}`);
        }

        const counts = await replaceAllData(payload.data);
        return c.json({ counts });
      } catch (error) {
        return handleRouteError(c, error);
      }
    },
  );
