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
    {},
    readOnlyToolAnnotations,
    async () => content(await api.get("/api/spending")),
  );
  server.tool(
    "update_spending",
    "支出申請・購入実績・予算・明細配賦を操作する。配賦と取消は利用者確認が必要。最新versionを指定する。通常決裁は既存残高を変えない。",
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
