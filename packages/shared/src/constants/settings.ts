export const DASHBOARD_PERIOD_PRESETS = [
  "next1Month",
  "next3Months",
  "next6Months",
  "next1Year",
  "all",
] as const;

export type DashboardPeriodPreset = (typeof DASHBOARD_PERIOD_PRESETS)[number];

export const TRANSACTION_DEFAULT_PERIOD_PRESETS = [
  "thisMonth",
  "lastMonth",
  "last3Months",
  "last6Months",
  "last1Year",
  "all",
] as const;

export type TransactionDefaultPeriodPreset = (typeof TRANSACTION_DEFAULT_PERIOD_PRESETS)[number];

export const DEFAULT_SETTINGS = {
  credit_card_assumption: "150000",
  credit_card_settlement_day: "27",
  forecast_months: "24",
  ui_dashboard_default_period: "next3Months",
  ui_transactions_default_period: "last3Months",
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
