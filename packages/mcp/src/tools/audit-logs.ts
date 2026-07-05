import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuditLogsResponse } from "@sui/shared";
import { z } from "zod";
import type { SuiApiClient } from "../api-client";
import { readOnlyToolAnnotations, textContent } from "../helpers";

function formatRecentChanges(data: AuditLogsResponse) {
  if (data.items.length === 0) {
    return "最近の変更はありません。";
  }

  return data.items
    .map((item) => `${item.createdAt} ${item.method} ${item.path} ${item.clientSource}`)
    .join("\n");
}

export function registerAuditLogTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "list_recent_changes",
    "監査ログから最近の変更を一覧する（読み取り専用）。日時・メソッド・パス・clientSource を1件1行で返す",
    {
      limit: z.number().int().min(1).max(100).optional().describe("取得件数（既定 20）"),
    },
    readOnlyToolAnnotations,
    async ({ limit = 20 }) => {
      const data = await apiClient.get<AuditLogsResponse>(`/api/audit-logs?limit=${limit}`);
      return textContent(formatRecentChanges(data));
    },
  );
}
