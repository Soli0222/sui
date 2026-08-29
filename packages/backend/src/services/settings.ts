import type { Prisma, PrismaClient } from "@sui/db";
import {
  DASHBOARD_PERIOD_PRESETS,
  DEFAULT_SETTINGS,
  TRANSACTION_DEFAULT_PERIOD_PRESETS,
  type DashboardPeriodPreset,
  type TransactionDefaultPeriodPreset,
  type UiSettingsResponse,
} from "@sui/shared";

const UI_SETTING_KEYS = [
  "ui_dashboard_default_period",
  "ui_transactions_default_period",
] as const;

type SettingsReader = PrismaClient | Prisma.TransactionClient;
type UiSettingsPatch = Partial<UiSettingsResponse>;

function isDashboardPeriodPreset(value: string | undefined): value is DashboardPeriodPreset {
  return value !== undefined && DASHBOARD_PERIOD_PRESETS.some((preset) => preset === value);
}

function isTransactionDefaultPeriodPreset(
  value: string | undefined,
): value is TransactionDefaultPeriodPreset {
  return value !== undefined && TRANSACTION_DEFAULT_PERIOD_PRESETS.some((preset) => preset === value);
}

export async function getUiSettings(prisma: SettingsReader): Promise<UiSettingsResponse> {
  const settings = await prisma.setting.findMany({
    where: { key: { in: [...UI_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  const dashboardDefaultPeriod = values.get("ui_dashboard_default_period");
  const transactionsDefaultPeriod = values.get("ui_transactions_default_period");

  return {
    dashboardDefaultPeriod: isDashboardPeriodPreset(dashboardDefaultPeriod)
      ? dashboardDefaultPeriod
      : DEFAULT_SETTINGS.ui_dashboard_default_period,
    transactionsDefaultPeriod: isTransactionDefaultPeriodPreset(transactionsDefaultPeriod)
      ? transactionsDefaultPeriod
      : DEFAULT_SETTINGS.ui_transactions_default_period,
  };
}

export async function updateUiSettings(
  prisma: PrismaClient,
  patch: UiSettingsPatch,
): Promise<UiSettingsResponse> {
  return prisma.$transaction(async (tx) => {
    if (patch.dashboardDefaultPeriod !== undefined) {
      await tx.setting.upsert({
        where: { key: "ui_dashboard_default_period" },
        create: {
          key: "ui_dashboard_default_period",
          value: patch.dashboardDefaultPeriod,
        },
        update: { value: patch.dashboardDefaultPeriod },
      });
    }

    if (patch.transactionsDefaultPeriod !== undefined) {
      await tx.setting.upsert({
        where: { key: "ui_transactions_default_period" },
        create: {
          key: "ui_transactions_default_period",
          value: patch.transactionsDefaultPeriod,
        },
        update: { value: patch.transactionsDefaultPeriod },
      });
    }

    return getUiSettings(tx);
  });
}
