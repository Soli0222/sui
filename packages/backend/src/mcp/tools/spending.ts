import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SuiApiClient } from "../client";
import { readOnlyToolAnnotations, updateToolAnnotations } from "../helpers";
import { spendingCommandSchema } from "../../services/spending-validation";
export function registerSpendingTools(server: McpServer, api: SuiApiClient) {
  const content = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  });
  server.tool(
    "get_spending",
    "支出決裁の申請、予算、明細、審査、補正余力と版を取得する",
    {
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
    },
    readOnlyToolAnnotations,
    async ({ month }) =>
      content(
        await api.get(month ? `/api/spending?month=${month}` : "/api/spending"),
      ),
  );
  server.tool(
    "preview_spending_import",
    "MFの月別CSVの差し替えをプレビューする。月は自動判定し、空ファイルだけmonthで補足する。確定はupdate_spendingのimport-confirmで行う。",
    {
      version: z.number().int().nonnegative(),
      filename: z.string(),
      base64: z.string(),
      month: z.string().optional(),
    },
    updateToolAnnotations,
    async (b) => content(await api.post("/api/spending/imports/preview", b)),
  );
  server.tool(
    "update_spending",
    "支出申請・購入完了・MF予算を操作する。購入記録と取消は利用者の指示に基づく。申請は単一のamountとcategoryを指定する。最新versionが必要。申請や購入記録はMF実績・予算残額・既存残高を変えない。",
    { version: z.number().int().nonnegative(), command: spendingCommandSchema },
    updateToolAnnotations,
    async (b) => content(await api.post("/api/spending/commands", b)),
  );
  server.tool(
    "review_spending",
    "支出申請をAI審査する。条件付きは未承認。補正予算の承認は振替予定を作成するが、振替確定は行わない。",
    { id: z.string(), version: z.number().int().nonnegative() },
    updateToolAnnotations,
    async ({ id, version }) =>
      content(
        await api.post(`/api/spending/${encodeURIComponent(id)}/review`, {
          version,
        }),
      ),
  );
  server.tool(
    "override_spending",
    "利用者の明示的な例外承認を記録する。理由必須。数値・整合性制約は回避できない。",
    {
      id: z.string(),
      version: z.number().int().nonnegative(),
      reason: z.string().min(1),
    },
    updateToolAnnotations,
    async ({ id, ...body }) =>
      content(
        await api.post(
          `/api/spending/${encodeURIComponent(id)}/override`,
          body,
        ),
      ),
  );
}
