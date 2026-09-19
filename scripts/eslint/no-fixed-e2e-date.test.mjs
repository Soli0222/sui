import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint, RuleTester } from "eslint";
import rule from "./no-fixed-e2e-date.mjs";

new RuleTester().run("no-fixed-e2e-date", rule, {
  valid: [
    'const date = getFutureDate(7);',
    'const date = `${year}-12-31`;',
    'const date = new Date(value);',
    'const date = new Date();',
    'const date = Date.UTC(year, month, 1);',
    'const amount = 2026;',
  ],
  invalid: [
    'const date = "2026-09-15";',
    'const month = "2026-12";',
    'const date = "2026/9/15";',
    'const label = "単発 2026-09-15";',
    'const label = `2026年9月15日 ${name}`;',
    'const label = /2026-09-15/;',
    'const date = new Date(2026, 8, 15);',
    'const date = new Date(0);',
    'const date = Date.UTC(2026, 8, 15);',
  ].map(code => ({ code, errors: [{ messageId: "fixed" }] })),
});

test("repository lint catches fixed fixtures and bypassed browser clock fixtures", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    'import { test } from "@playwright/test"; test("future", () => { new Date("2026-09-15"); });',
    { filePath: "e2e/date-policy.spec.ts" },
  );
  assert.ok(result.messages.some(message => message.ruleId === "sui/no-fixed-e2e-date"));
  assert.ok(result.messages.some(message => message.ruleId === "no-restricted-imports"));
  const [helper] = await eslint.lintText('export const date = "2026-09-15";', {
    filePath: "e2e/helpers/date-policy.ts",
  });
  assert.ok(helper.messages.some(message => message.ruleId === "sui/no-fixed-e2e-date"));
});

test("repository lint permits a scoped exception and reports stale exceptions", async () => {
  const eslint = new ESLint();
  const directive = "// eslint-disable-next-line sui/no-fixed-e2e-date -- Historical record outside the current window.\n";
  const [allowed] = await eslint.lintText(`${directive}export const date = "2020-01-10";`, {
    filePath: "e2e/helpers/date-policy.ts",
  });
  assert.equal(allowed.errorCount, 0);
  const [unused] = await eslint.lintText(`${directive}export const date = new Date();`, {
    filePath: "e2e/helpers/date-policy.ts",
  });
  assert.ok(unused.messages.some(message => message.message.includes("Unused eslint-disable")));
});
