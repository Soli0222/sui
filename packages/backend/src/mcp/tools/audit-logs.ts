import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuditLogsResponse, AuditLogStatusFilter } from "@sui/shared";
import { z } from "zod";
import type { SuiApiClient } from "../client";
import { readOnlyToolAnnotations, textContent } from "../helpers";

function formatRecentChanges(data: AuditLogsResponse) {
  if (data.items.length === 0) {
    return "該当する監査ログはありません。";
  }

  return data.items
    .map((item) => `${item.createdAt} ${item.status} ${item.method} ${item.path} ${item.clientSource}`)
    .join("\n");
}

export function registerAuditLogTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "list_recent_changes",
    "成功した変更と失敗したリクエストの監査ログを一覧する（読み取り専用）。日時・HTTP status・メソッド・パス・clientSource を1件1行で返す",
    {
      limit: z.number().int().min(1).max(100).optional().describe("取得件数（既定 20）"),
      status: z.enum(["all", "2xx", "4xx", "5xx"]).optional().describe("HTTP status 区分（既定 all）"),
    },
    readOnlyToolAnnotations,
    async ({ limit = 20, status = "all" }) => {
      const filter: AuditLogStatusFilter = status;
      const data = await apiClient.get<AuditLogsResponse>(
        `/api/audit-logs?limit=${limit}${filter === "all" ? "" : `&status=${filter}`}`,
      );
      return textContent(formatRecentChanges(data));
    },
  );
}
