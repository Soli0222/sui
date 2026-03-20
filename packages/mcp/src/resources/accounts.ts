import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AccountsResponse,
  CreditCardsResponse,
  LoansResponse,
  RecurringItemsResponse,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { jsonResource } from "../helpers";

export function registerDataResources(server: McpServer, apiClient: SuiApiClient) {
  server.resource(
    "accounts",
    "sui://accounts",
    { description: "全口座の一覧と残高" },
    async (uri) => {
      const data = await apiClient.get<AccountsResponse>("/api/accounts");
      return jsonResource(uri.href, data);
    },
  );

  server.resource(
    "recurring-items",
    "sui://recurring-items",
    { description: "固定収支の一覧" },
    async (uri) => {
      const data = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
      return jsonResource(uri.href, data);
    },
  );

  server.resource(
    "credit-cards",
    "sui://credit-cards",
    { description: "クレジットカード一覧" },
    async (uri) => {
      const data = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
      return jsonResource(uri.href, data);
    },
  );

  server.resource(
    "loans",
    "sui://loans",
    { description: "ローン一覧と返済状況" },
    async (uri) => {
      const data = await apiClient.get<LoansResponse>("/api/loans");
      return jsonResource(uri.href, data);
    },
  );
}
