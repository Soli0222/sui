// Test subprocesses only. Leave timers/performance.now() real for servers and Playwright.
if (process.env.SUI_E2E_NOW) {
  const NativeDate = globalThis.Date;
  const instant = NativeDate.parse(process.env.SUI_E2E_NOW);
  if (!Number.isFinite(instant)) throw new Error("invalid SUI_E2E_NOW");
  globalThis.Date = new Proxy(NativeDate, {
    apply() { return new NativeDate(instant).toString(); },
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [instant], newTarget);
    },
    get(target, key, receiver) {
      return key === "now" ? () => instant : Reflect.get(target, key, receiver);
    },
  });
}
