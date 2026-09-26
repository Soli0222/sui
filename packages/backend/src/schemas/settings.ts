import { DASHBOARD_PERIOD_PRESETS, TRANSACTION_DEFAULT_PERIOD_PRESETS } from "@sui/shared";
import { z } from "zod";

export const updateUiSettingsShape = {
  dashboardDefaultPeriod: z.enum(DASHBOARD_PERIOD_PRESETS).optional(),
  transactionsDefaultPeriod: z.enum(TRANSACTION_DEFAULT_PERIOD_PRESETS).optional(),
};
export const updateUiSettingsSchema = z.object(updateUiSettingsShape)
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required",
  });
