import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateLoanPayload, Loan, LoansResponse, UpdateLoanPayload } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatLoansText } from "../format";
import { dateSchema, positiveMoneySchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

const loanPayload = {
  name: z.string().min(1).max(100).describe("ローン名"),
  totalAmount: positiveMoneySchema.describe("総額"),
  paymentCount: positiveMoneySchema.describe("支払回数"),
  startDate: dateSchema.describe("開始日"),
  accountId: uuidSchema.describe("支払口座 ID"),
};

export function registerLoanTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_loans", "ローン一覧を取得する", {}, async () => {
    const data = await apiClient.get<LoansResponse>("/api/loans");
    return textContent(formatLoansText(data));
  });

  server.tool("create_loan", "ローンを作成する", loanPayload, async (args) => {
    const loan = await apiClient.post<Loan>("/api/loans", args as CreateLoanPayload);
    return textContent(`ローンを作成しました: ${loan.name}`);
  });

  server.tool(
    "update_loan",
    "ローンを更新する",
    {
      id: uuidSchema.describe("ローン ID"),
      ...loanPayload,
    },
    async ({ id, ...payload }) => {
      const loan = await apiClient.put<Loan>(`/api/loans/${id}`, payload as UpdateLoanPayload);
      return textContent(`ローンを更新しました: ${loan.name}`);
    },
  );

  server.tool(
    "delete_loan",
    "ローンを削除する",
    { id: uuidSchema.describe("ローン ID") },
    async ({ id }) => {
      await apiClient.delete(`/api/loans/${id}`);
      return textContent(`ローンを削除しました: ${id}`);
    },
  );
}
