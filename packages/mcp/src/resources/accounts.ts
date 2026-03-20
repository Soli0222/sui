import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AccountsResponse,
  CreditCardsResponse,
  LoansResponse,
  RecurringItemsResponse,
  TransactionsResponse,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { dateSchema, pageSchema, jsonResource } from "../helpers";

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

  server.resource(
    "transactions",
    new ResourceTemplate("sui://transactions{?page,startDate,endDate}", { list: undefined }),
    { description: "ページ指定で取引履歴を取得する" },
    async (uri, variables) => {
      const page = pageSchema.parse(Number(variables.page ?? uri.searchParams.get("page") ?? "1"));
      const startDate = variables.startDate ?? uri.searchParams.get("startDate") ?? undefined;
      const endDate = variables.endDate ?? uri.searchParams.get("endDate") ?? undefined;
      const params = new URLSearchParams({ page: String(page) });

      if (startDate) {
        params.set("startDate", dateSchema.parse(startDate));
      }
      if (endDate) {
        params.set("endDate", dateSchema.parse(endDate));
      }

      const data = await apiClient.get<TransactionsResponse>(`/api/transactions?${params.toString()}`);
      return jsonResource(uri.href, data);
    },
  );
}
