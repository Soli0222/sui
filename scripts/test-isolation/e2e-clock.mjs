// Business date for every ordinary E2E run: noon in Japan, away from month boundaries.
export const E2E_NOW = "2026-06-15T03:00:00.000Z";

export function e2eClockEnv(env = process.env) {
  const preload = new URL("./clock-preload.mjs", import.meta.url).href;
  return {
    ...env,
    SUI_E2E_NOW: E2E_NOW,
    NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
  };
}
