import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateSettlementPayload,
  PersonSummaryResponse,
  PeopleResponse,
  SettlementsResponse,
  SplitsResponse,
  SplitResponse,
} from "@sui/shared";
import type { SuiApiClient } from "../client";
import {
  createToolAnnotations,
  dateSchema,
  deleteToolAnnotations,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";
import { z } from "zod";

export function registerSplitTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "list_people",
    "割り勘メンバー一覧を取得する",
    {},
    readOnlyToolAnnotations,
    async () => {
      const data = await apiClient.get<PeopleResponse>("/api/people");
      return textContent(formatPeopleText(data));
    },
  );

  server.tool(
    "get_person_summary",
    "指定メンバーの貸借対照表（未回収金額、持分、精算履歴）を取得する",
    {
      personId: uuidSchema.describe("メンバー ID"),
    },
    readOnlyToolAnnotations,
    async ({ personId }) => {
      const data = await apiClient.get<PersonSummaryResponse>(`/api/people/${personId}/summary`);
      return textContent(formatPersonSummaryText(data));
    },
  );

  server.tool(
    "set_transaction_split",
    "割り勘取引を登録・更新する",
    {
      splitId: uuidSchema.optional().describe("更新対象の割り勘取引 ID（省略時は新規作成）"),
      date: dateSchema.describe("日付（YYYY-MM-DD）"),
      description: z.string().min(1).max(200).describe("内容"),
      memo: z.string().max(200).optional().describe("メモ"),
      amount: positiveMoneySchema.describe("合計金額"),
      method: z.enum(["equal", "ratio", "amount"]).describe("割り勘方法"),
      ownRatio: z.number().int().min(1).optional().describe("ratio 方式の自分の重み"),
      shares: z
        .array(
          z.object({
            personId: uuidSchema.describe("メンバー ID"),
            ratio: z.number().int().min(1).optional().describe("ratio 方式の重み"),
            amount: positiveMoneySchema.optional().describe("amount 方式の金額"),
          }),
        )
        .min(1)
        .describe("メンバー別の割り勘設定"),
    },
    updateToolAnnotations,
    async ({ splitId, date, description, memo, amount, method, ownRatio, shares }) => {
      const payload = { date, description, memo: memo ?? null, amount, method, ownRatio: ownRatio ?? null, shares };
      if (splitId) {
        const result = await apiClient.put<SplitResponse>(`/api/splits/${splitId}`, payload);
        return textContent(`割り勘取引 ${result.split.id} を更新しました: ${result.shares.length} 名`);
      }
      const result = await apiClient.post<SplitResponse>("/api/splits", payload);
      return textContent(`割り勘取引 ${result.split.id} を作成しました: ${result.shares.length} 名`);
    },
  );

  server.tool(
    "list_splits",
    "割り勘一覧を取得する",
    {
      personId: uuidSchema.optional().describe("メンバー ID で絞り込む"),
      status: z.enum(["unsettled", "partial", "settled"]).optional().describe("精算状況で絞り込む"),
    },
    readOnlyToolAnnotations,
    async ({ personId, status }) => {
      const params = new URLSearchParams();
      if (personId) {
        params.set("personId", personId);
      }
      if (status) {
        params.set("status", status);
      }
      const query = params.toString();
      const data = await apiClient.get<SplitsResponse>(query ? `/api/splits?${query}` : "/api/splits");
      return textContent(formatSplitsText(data));
    },
  );

  server.tool(
    "create_settlement",
    "精算を記録する",
    {
      kind: z.enum(["transaction", "offset"]).describe("精算種別"),
      personId: uuidSchema.describe("メンバー ID"),
      transactionId: uuidSchema.optional().describe("transaction 種別の場合の振替取引 ID"),
      date: dateSchema.optional().describe("offset 種別の場合の日付（YYYY-MM-DD）"),
      note: z.string().max(200).optional().describe("メモ"),
      allocations: z
        .array(
          z.object({
            shareId: uuidSchema.describe("割り勘持分 ID"),
            amount: positiveMoneySchema.describe("精算金額"),
          }),
        )
        .min(1)
        .describe("精算対象の持分"),
    },
    createToolAnnotations,
    async ({ kind, personId, transactionId, date, note, allocations }) => {
      const payload: CreateSettlementPayload = {
        kind,
        personId,
        transactionId: transactionId ?? null,
        date,
        note: note ?? null,
        allocations,
      };
      const result = await apiClient.post<SettlementsResponse[number]>("/api/settlements", payload);
      return textContent(
        `精算を記録しました: ${result.personName} ${result.allocations.reduce((sum, a) => sum + a.amount, 0).toLocaleString("ja-JP")}円（${result.date}）`,
      );
    },
  );

  server.tool(
    "delete_settlement",
    "精算を削除する",
    {
      settlementId: uuidSchema.describe("精算 ID"),
    },
    deleteToolAnnotations,
    async ({ settlementId }) => {
      await apiClient.delete(`/api/settlements/${settlementId}`);
      return textContent(`精算を削除しました: ${settlementId}`);
    },
  );
}

function formatPeopleText(people: PeopleResponse) {
  if (people.length === 0) {
    return "メンバーはいません。";
  }
  const lines = people.map((person) => {
    const outstanding = Object.entries(person.outstandingAmount)
      .map(([currency, amount]) => `${Number(amount).toLocaleString("ja-JP")} ${currency}`)
      .join(", ") || "0";
    return `  ${person.name}: 未回収 ${outstanding}`;
  });
  return [`メンバー一覧: ${people.length}件`, ...lines].join("\n");
}

function formatPersonSummaryText(summary: PersonSummaryResponse) {
  const outstanding = Object.entries(summary.outstandingAmount)
    .map(([currency, amount]) => `${Number(amount).toLocaleString("ja-JP")} ${currency}`)
    .join(", ") || "0";
  const lines = [
    `メンバー: ${summary.person.name}`,
    `未回収合計: ${outstanding}`,
    "",
    "【未精算持分】",
  ];
  const unsettledShares = summary.shares.filter((share) => share.remainingAmount > 0);
  if (unsettledShares.length === 0) {
    lines.push("  未精算の持分はありません");
  } else {
    for (const share of unsettledShares) {
      lines.push(
        `  ${share.splitDate} ${share.splitDescription}: ${share.personName} 残額 ${share.remainingAmount.toLocaleString("ja-JP")} / 元額 ${share.amount.toLocaleString("ja-JP")}（${share.status}）`,
      );
    }
  }
  lines.push("", "【精算履歴】");
  if (summary.settlements.length === 0) {
    lines.push("  精算履歴はありません");
  } else {
    for (const settlement of summary.settlements) {
      const total = settlement.allocations.reduce((sum, a) => sum + a.amount, 0);
      lines.push(
        `  ${settlement.date} ${settlement.kind === "transaction" ? "取引精算" : "相殺"} ${total.toLocaleString("ja-JP")}円 / ${settlement.note ?? ""}`,
      );
    }
  }
  return lines.join("\n");
}

function formatSplitsText(splits: SplitsResponse) {
  if (splits.length === 0) {
    return "割り勘はありません。";
  }
  const lines = splits.map((split) => {
    const total = split.shares.reduce((sum, share) => sum + share.remainingAmount, 0);
    return `  ${split.date} ${split.description} 自分負担 ${split.ownShare.toLocaleString("ja-JP")} / 未回収 ${total.toLocaleString("ja-JP")}（${split.status}）`;
  });
  return [`割り勘一覧: ${splits.length}件`, ...lines].join("\n");
}
