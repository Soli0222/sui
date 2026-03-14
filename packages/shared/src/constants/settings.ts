export const DEFAULT_SETTINGS = {
  credit_card_assumption: "150000",
  credit_card_settlement_day: "27",
  forecast_months: "24",
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

