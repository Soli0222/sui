// Keep all selected dates in the future so real browser cookie expiry stays valid.
export function calendarInstant(profile, now = new Date()) {
  const year = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear() + 1;
  switch (profile) {
    case undefined:
    case "":
    case "live": return undefined;
    case "month-end": return new Date(Date.UTC(year, 2, 0, 3)).toISOString();
    case "year-end": return new Date(Date.UTC(year, 11, 31, 3)).toISOString();
    case "new-year": return new Date(Date.UTC(year + 1, 0, 1, 3)).toISOString();
    default: throw new Error(`unknown E2E calendar profile: ${profile}`);
  }
}

export function calendarEnv(env = process.env) {
  const instant = calendarInstant(env.SUI_E2E_CALENDAR);
  if (!instant) return { ...env, SUI_E2E_NOW: "" };
  const preload = new URL("./clock-preload.mjs", import.meta.url).href;
  return {
    ...env,
    SUI_E2E_NOW: instant,
    NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
  };
}
