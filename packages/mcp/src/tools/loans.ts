import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateLoanPayload, Loan, LoansResponse, UpdateLoanPayload } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatLoansText } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
  dateShiftPolicySchema,
  deleteToolAnnotations,
  formatDeletePreview,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";
import { z } from "zod";

const paymentMethodSchema = z.enum(["account_withdrawal", "credit_card"]);

const baseLoanPayload = {
  name: z.string().min(1).max(100).describe("ローン名"),
  totalAmount: positiveMoneySchema.describe("総額"),
  paymentCount: positiveMoneySchema.describe("支払回数"),
  startDate: dateSchema.describe("開始日"),
  dateShiftPolicy: dateShiftPolicySchema.optional().describe("土日祝の扱い"),
  accountId: uuidSchema.nullable().describe("支払口座 ID。クレカ分割の場合は null"),
};

const createLoanPayload = {
  ...baseLoanPayload,
  paymentMethod: paymentMethodSchema.optional().describe("支払方法"),
};

const updateLoanPayload = {
  ...baseLoanPayload,
  paymentMethod: paymentMethodSchema.describe("支払方法"),
};

export function registerLoanTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_loans", "ローン一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<LoansResponse>("/api/loans");
    return textContent(formatLoansText(data));
  });

  server.tool("create_loan", "ローンを作成する", createLoanPayload, createToolAnnotations, async (args) => {
    const loan = await apiClient.post<Loan>("/api/loans", args as CreateLoanPayload);
    return textContent(`ローンを作成しました: ${loan.name}`);
  });

  server.tool(
    "update_loan",
    "ローンを更新する",
    {
      id: uuidSchema.describe("ローン ID"),
      ...updateLoanPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const loan = await apiClient.put<Loan>(`/api/loans/${id}`, payload as UpdateLoanPayload);
      return textContent(`ローンを更新しました: ${loan.name}`);
    },
  );

  server.tool(
    "delete_loan",
    "ローンを削除する。confirm が true でない場合は API の DELETE を呼ばず、対象ローンの要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("ローン ID"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const loans = await apiClient.get<LoansResponse>("/api/loans");
        const loan = loans.find((entry) => entry.id === id);
        return textContent(formatDeletePreview(
          "ローン",
          id,
          loan ? `${loan.name}（総額 ¥${loan.totalAmount.toLocaleString("ja-JP")}、残 ${loan.remainingPayments}回）` : null,
        ));
      }

      await apiClient.delete(`/api/loans/${id}`);
      return textContent(`ローンを削除しました: ${id}`);
    },
  );
}
