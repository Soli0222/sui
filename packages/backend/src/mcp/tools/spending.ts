import type { SpendingResponse } from "@sui/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SuiApiClient } from "../client";
import {
  readOnlyToolAnnotations,
  updateToolAnnotations,
  textContent,
  registerTool,
} from "../helpers";
import { spendingCommandSchema } from "../../services/spending-validation";
export function registerSpendingTools(server: McpServer, api: SuiApiClient) {
  const content = (data: unknown) => textContent("支出決裁の操作結果", { data });
  const reviewContent = async (data: Record<string, unknown>) => {
    const state = await api.get<SpendingResponse>("/api/spending");
    return content({ ...data, version: state.version });
  };
  registerTool(server,
    "get_spending",
    "支出決裁の申請、予算、明細、審査、補正余力と版を取得する",
    {
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional().describe("対象年月。利用者指定 YYYY-MM"),
    },
    readOnlyToolAnnotations,
    async ({ month }) =>
      content(
        await api.get(month ? `/api/spending?month=${month}` : "/api/spending"),
      ),
  );
  registerTool(server,
    "preview_spending_import",
    "MFの月別CSVの差し替えをプレビューする。月は自動判定し、空ファイルだけmonthで補足する。確定はupdate_spendingのimport-confirmで行う。",
    {
      version: z.number().int().nonnegative().describe("取得元: get_spending.data.version または直前の変更結果 data.version。preview_spending_import 後は data.state.version を使う"),
      filename: z.string(),
      base64: z.string(),
      month: z.string().optional().describe("対象年月。利用者指定 YYYY-MM"),
    },
    updateToolAnnotations,
    async (b) => textContent("取込プレビューを保存しました。明細の差し替えは未実行です", { data: await api.post("/api/spending/imports/preview", b), executed: false }, "preview"),
  );
  registerTool(server,
    "update_spending",
    "支出申請・購入完了・MF予算を操作する。購入記録と取消は利用者の指示に基づく。申請は単一のamountとcategoryを指定する。answer（id・reviewId・answer）で利用者の回答を保存し、最新versionでreview_spendingを呼ぶ。回答は利用者の入力に基づく。settings.supplementalLimitsで任意の利用枠を設定できる。最新versionが必要。申請や購入記録はMF実績・予算残額・既存残高を変えない。",
    { version: z.number().int().nonnegative().describe("取得元: get_spending.data.version または直前の変更結果 data.version。preview_spending_import 後は data.state.version を使う"), command: spendingCommandSchema.describe("ID取得元: request/answer/cancel/delete/purchase/return-funds の id と input.relatedIds は get_spending.data.ledger.requests[].id。reviewId は data.ledger.reviews[].id、detailId は data.ledger.details[].id、linkId は data.ledger.requests[].fundingLinks[].id、replaceId は data.ledger.budgetProposals[].id。import-confirm.id は preview_spending_import.data.preview.id、resolutions は同 preview.rows の candidates/existingId。payment-link.target.id は kind=account なら list_accounts.accounts[].id、kind=card なら list_credit_cards.items[].id。input.funding.sourceId/destinationId は list_accounts.accounts[].id。settings.supplementalLimits[].id は新規時に利用者が一意に指定、既存は get_spending.data.ledger.settings.supplementalLimits[].id。month/from/to は利用者指定 YYYY-MM。取得した現行 input/settings を保持して指定する") },
    updateToolAnnotations,
    async (b) => content(await api.post("/api/spending/commands", b)),
  );
  registerTool(server,
    "review_spending",
    "支出申請をAI審査する。条件付きは未承認。補正予算の承認は振替予定を作成するが、振替確定は行わない。",
    { id: z.string().describe("取得元: get_spending.data.ledger.requests[].id"), version: z.number().int().nonnegative().describe("取得元: get_spending.data.version または直前の変更結果 data.version。preview_spending_import 後は data.state.version を使う") },
    updateToolAnnotations,
    async ({ id, version }) =>
      reviewContent(
        await api.post(`/api/spending/${encodeURIComponent(id)}/review`, {
          version,
        }),
      ),
  );
  registerTool(server,
    "override_spending",
    "利用者の明示的な例外承認を記録する。理由必須。数値・整合性制約は回避できない。",
    {
      id: z.string().describe("取得元: get_spending.data.ledger.requests[].id"),
      version: z.number().int().nonnegative().describe("取得元: get_spending.data.version または直前の変更結果 data.version。preview_spending_import 後は data.state.version を使う"),
      reason: z.string().min(1),
    },
    updateToolAnnotations,
    async ({ id, ...body }) =>
      reviewContent(
        await api.post(
          `/api/spending/${encodeURIComponent(id)}/override`,
          body,
        ),
      ),
  );
}
