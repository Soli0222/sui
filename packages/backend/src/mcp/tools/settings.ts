import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UiSettingsResponse } from "@sui/shared";
import { updateUiSettingsShape } from "../../routes/settings";
import type { SuiApiClient } from "../client";
import { readOnlyToolAnnotations, registerTool, textContent, updateToolAnnotations } from "../helpers";

export function registerSettingsTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "get_ui_settings", "ダッシュボードと取引一覧の表示期間設定を取得する", {}, readOnlyToolAnnotations,
    async () => {
      const settings = await apiClient.get<UiSettingsResponse>("/api/settings");
      return textContent("表示期間設定を取得しました", { settings });
    });
  registerTool(server, "update_ui_settings", "ダッシュボードまたは取引一覧の既定表示期間を部分更新する",
    updateUiSettingsShape, updateToolAnnotations,
    async (payload) => {
      const settings = await apiClient.put<UiSettingsResponse>("/api/settings", payload);
      return textContent("表示期間設定を更新しました", { settings });
    });
}
