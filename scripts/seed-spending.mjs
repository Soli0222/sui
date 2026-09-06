// Synthetic fixtures only. Never read or derive data from a user's MF export.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [baseUrl, outputDir] = process.argv.slice(2);
if (!baseUrl || !outputDir)
  throw new Error("seed.sh spending 経由で実行してください");
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
}).format(new Date());
const month = today.slice(0, 7);
const shiftMonth = (offset) => {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
};
async function api(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SUI_SEED_API_TOKEN
        ? { Authorization: `Bearer ${process.env.SUI_SEED_API_TOKEN}` }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
let state = await api("/api/spending");
// Monthly imports replace data. Never overwrite an existing manual testing session.
if (
  state.ledger.requests.length ||
  state.ledger.details.length ||
  state.ledger.budgets.length ||
  state.ledger.budgetProposals?.length ||
  state.ledger.plans.length ||
  state.ledger.imports.length
) {
  console.log(
    "支出決裁のデータが既にあるため、設定・明細・申請を保持してスキップします。",
  );
  process.exit(0);
}
async function command(command) {
  state = await api("/api/spending/commands", {
    version: state.version,
    command,
  });
  return state;
}
const accounts = await api("/api/accounts");
async function account(
  name,
  balance,
  balanceOffset,
  supplementalBudgetEnabled,
) {
  const existing = accounts.find((a) => a.name === name);
  if (existing) return existing;
  return api("/api/accounts", {
    name,
    balance,
    balanceOffset,
    supplementalBudgetEnabled,
    sortOrder: 20,
  });
}
await account("テスト用・補正予算口座", 240000, 40000, true);
const destination = await account("テスト用・支払口座", 180000, 0, false);
const cards = await api("/api/credit-cards");
const card =
  cards.find((c) => c.name === "テスト用カード") ??
  (await api("/api/credit-cards", {
    name: "テスト用カード",
    accountId: destination.id,
    settlementDay: 27,
    assumptionAmount: 0,
    sortOrder: 20,
  }));
await command({
  action: "settings",
  settings: {
    ...state.ledger.settings,
    threshold: state.ledger.settings.threshold ?? 10000,
    freshnessDays: state.ledger.settings.freshnessDays ?? 7,
    approvalDays: state.ledger.settings.approvalDays ?? 14,
    fundingDays: state.ledger.settings.fundingDays ?? 30,
  },
});
await command({
  action: "budget-proposal",
  proposal: {
    name: "架空データ・MF月額予算",
    from: shiftMonth(-3),
    to: null,
    categories: [
      { category: "食費", amount: 45000 },
      { category: "趣味・娯楽", amount: 25000 },
      { category: "通信費", amount: 8000 },
    ],
    reason: "ローカルでの手動テスト専用の設定値",
  },
});
await command({
  action: "payment-link",
  source: "テスト用カード",
  target: { kind: "card", id: card.id },
});
await command({
  action: "payment-link",
  source: "テスト用・支払口座",
  target: { kind: "account", id: destination.id },
});
await mkdir(outputDir, { recursive: true });
const columns = [
  "計算対象",
  "日付",
  "内容",
  "金額（円）",
  "保有金融機関",
  "大項目",
  "中項目",
  "メモ",
  "振替",
  "ID",
];
const csv = (rows) =>
  "\uFEFF" +
  [columns, ...rows]
    .map((row) =>
      row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n") +
  "\r\n";
for (let offset = -3; offset <= 0; offset++) {
  const m = shiftMonth(offset);
  const last = new Date(
    Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0),
  ).getUTCDate();
  const through = offset === 0 ? Number(today.slice(8)) : last;
  const rows = [];
  const add = (
    day,
    key,
    description,
    amount,
    category,
    subcategory,
    payment = "テスト用カード",
    included = 1,
    transfer = 0,
  ) => {
    if (day > through) return;
    rows.push([
      included,
      `${m.replace("-", "/")}/${String(day).padStart(2, "0")}`,
      description,
      amount,
      payment,
      category,
      subcategory,
      "完全な架空データ・手動テスト専用",
      transfer,
      `sui-seed-${m}-${key}`,
    ]);
  };
  for (let day = 1; day <= through; day++)
    add(
      day,
      `food-${day}`,
      "架空ストア 食料品",
      -200 - (offset + 3) * 50,
      "食費",
      "食料品",
    );
  add(
    1,
    "hobby",
    '架空書店 "学習", 趣味の本',
    -300,
    "趣味・娯楽",
    "その他趣味・娯楽",
  );
  add(
    1,
    "fixed",
    "架空回線 月額料金",
    -4800,
    "通信費",
    "携帯電話",
    "テスト用・支払口座",
  );
  add(
    1,
    "income",
    "架空の収入",
    10000,
    "収入",
    "その他入金",
    "テスト用・支払口座",
  );
  add(
    1,
    "transfer",
    "架空の振替",
    -3000,
    "未分類",
    "未分類",
    "テスト用・支払口座",
    1,
    1,
  );
  add(
    1,
    "excluded",
    "架空の集計対象外",
    -500,
    "未分類",
    "未分類",
    "テスト用カード",
    0,
  );
  if (offset === -2)
    add(
      12,
      "oneoff",
      "架空の一度限りの催し",
      -9000,
      "趣味・娯楽",
      "その他趣味・娯楽",
    );
  if (offset === 0)
    add(
      through,
      "manual",
      "架空ショップ 手動紐づけ用",
      -6000,
      "趣味・娯楽",
      "その他趣味・娯楽",
    );
  const filename = `架空_収入・支出詳細_${m}-01_${m}-${last}.csv`;
  const content = csv(rows);
  await writeFile(join(outputDir, filename), content);
  const result = await api("/api/spending/imports/preview", {
    version: state.version,
    filename,
    base64: Buffer.from(content).toString("base64"),
  });
  state = result.state;
  if (result.preview.errors.length)
    throw new Error("生成したCSVに不正行があります");
  await command({
    action: "import-confirm",
    id: result.preview.id,
    resolutions: {},
    confirmedCoverage: true,
    acceptErrors: false,
  });
  const fixedId = `sui-seed-fixed-${m}`;
  await command({
    action: "plan",
    id: fixedId,
    month: m,
    category: "通信費",
    name: "架空回線 月額料金",
    amount: 4800,
    date: `${m}-01`,
    type: "fixed",
    reason: "架空の固定支出",
  });
  for (const detail of state.ledger.details.filter((d) =>
    d.date.startsWith(m),
  )) {
    if (
      [
        "sui-seed-" + m + "-fixed",
        "sui-seed-" + m + "-oneoff",
        "sui-seed-" + m + "-manual",
      ].includes(detail.sourceId)
    ) {
      await command({
        action: "classify",
        detailId: detail.id,
        oneOff: !detail.sourceId.endsWith("-fixed"),
        fixedId: detail.sourceId.endsWith("-fixed") ? fixedId : null,
        refundOf: null,
        reason: "架空の固定費・単発支出の分類",
      });
    }
  }
  console.log(`  MF取込 ${m}: ${rows.length}件`);
}
await writeFile(
  join(outputDir, "README.txt"),
  `すべて架空のCSVです。元のCSVを再取込しても重複しません。\n申請は未作成です。\n通常予算: 趣味・娯楽 / 5,000円の任意申請や、50,000円の予算超過を試せます。\n明細紐づけ: ${today} / 架空ショップ 手動紐づけ用 / 6,000円 / テスト用カードで事後申請できます。\n補正予算: テスト用・補正予算口座 → テスト用・支払口座。振替は申請承認後に作られます。\nAI接続は決裁設定で入力してください。既存の接続設定・APIキーは保持します。\n`,
);
console.log(`  CSVと手動テスト手順: ${outputDir}`);
console.log(
  "  申請は作成していません。AI接続は既存設定を保持しています（未設定ならUIで設定）。",
);
