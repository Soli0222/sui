import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BalanceHistoryResponse, TransactionsResponse } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { booleanFlagSchema, dateSchema, jsonResource, limitSchema, pageSchema, uuidSchema } from "../helpers";

export function registerTransactionResources(server: McpServer, apiClient: SuiApiClient) {
  const readTransactions = async (uri: URL, variables: Record<string, string | string[]>) => {
    const page = pageSchema.parse(Number(variables.page ?? uri.searchParams.get("page") ?? "1"));
    const limit = variables.limit ?? uri.searchParams.get("limit") ?? undefined;
    const accountId = variables.accountId ?? uri.searchParams.get("accountId") ?? undefined;
    const startDate = variables.startDate ?? uri.searchParams.get("startDate") ?? undefined;
    const endDate = variables.endDate ?? uri.searchParams.get("endDate") ?? undefined;
    const params = new URLSearchParams({ page: String(page) });

    if (limit) {
      params.set("limit", String(limitSchema.parse(Number(limit))));
    }
    if (accountId) {
      params.set("accountId", uuidSchema.parse(String(accountId)));
    }
    if (startDate) {
      params.set("startDate", dateSchema.parse(startDate));
    }
    if (endDate) {
      params.set("endDate", dateSchema.parse(endDate));
    }

    const data = await apiClient.get<TransactionsResponse>(`/api/transactions?${params.toString()}`);
    return jsonResource(uri.href, data);
  };

  server.resource(
    "transactions",
    new ResourceTemplate("sui://transactions{?page,startDate,endDate}", { list: undefined }),
    { description: "ページ・期間指定で取引履歴を取得する" },
    readTransactions,
  );

  server.resource(
    "transactions-filtered",
    new ResourceTemplate("sui://transactions{?page,limit,accountId,startDate,endDate}", { list: undefined }),
    { description: "ページ・件数・口座・期間指定で取引履歴を取得する" },
    readTransactions,
  );

  server.resource(
    "balance-history",
    new ResourceTemplate("sui://balance-history{?accountId,startDate,endDate,applyOffset}", {
      list: undefined,
    }),
    { description: "過去の残高推移データ" },
    async (uri, params) => {
      const query = new URLSearchParams();
      const applyOffset = booleanFlagSchema.parse(params.applyOffset ?? uri.searchParams.get("applyOffset") ?? "true");

      if (params.accountId) {
        query.set("accountId", uuidSchema.parse(String(params.accountId)));
      }
      if (params.startDate) {
        query.set("startDate", dateSchema.parse(String(params.startDate)));
      }
      if (params.endDate) {
        query.set("endDate", dateSchema.parse(String(params.endDate)));
      }
      query.set("applyOffset", String(applyOffset));

      const data = await apiClient.get<BalanceHistoryResponse>(
        `/api/transactions/balance-history?${query.toString()}`,
      );
      return jsonResource(uri.href, data);
    },
  );
}
