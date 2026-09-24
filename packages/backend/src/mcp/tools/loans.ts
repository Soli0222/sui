import type { AccountsResponse } from "@sui/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateLoanPayload, Loan, LoansResponse, UpdateLoanPayload } from "@sui/shared";
import type { SuiApiClient } from "../client";
import { formatLoansText, formatCurrency } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
  dateShiftPolicySchema,
  deleteToolAnnotations,
  deletePreview,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
  registerTool,
  compactRecord,
} from "../helpers";
import { z } from "zod";

const paymentMethodSchema = z.enum(["account_withdrawal", "credit_card"]);

const baseLoanPayload = {
  name: z.string().min(1).max(100).describe("ローン名"),
  totalAmount: positiveMoneySchema.describe("総額：対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000）。口座未指定のカード払いはJPY"),
  paymentCount: positiveMoneySchema.describe("支払回数"),
  startDate: dateSchema.describe("開始日"),
  dateShiftPolicy: dateShiftPolicySchema.optional().describe("土日祝の扱い"),
  accountId: uuidSchema.nullable().describe("支払口座 ID。クレカ分割の場合は null。取得元: list_accounts.accounts[].id"),
};

const createLoanPayload = {
  ...baseLoanPayload,
  paymentMethod: paymentMethodSchema.optional().describe("支払方法"),
};

const updateLoanPayload = {
  ...baseLoanPayload,
  paymentMethod: paymentMethodSchema.optional().describe("支払方法。省略時は現在の方法を維持する"),
};

export function registerLoanTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "list_loans", "ローン一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<LoansResponse>("/api/loans");
    return textContent(formatLoansText(data), { items: data.map((loan) => ({ ...compactRecord(loan), startDate: loan.startDate.slice(0, 10) })), complete: true });
  });

  registerTool(server, "create_loan", "ローンを作成する", createLoanPayload, createToolAnnotations, async (args) => {
    const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
    const loan = await apiClient.post<Loan>("/api/loans", args as CreateLoanPayload);
    return textContent(`ローンを作成しました: ${loan.name}`, { item: { ...compactRecord({ ...loan, account: accounts.find((account) => account.id === loan.accountId) ?? null }), startDate: loan.startDate.slice(0, 10) } });
  });

  registerTool(server,
    "update_loan",
    "ローンを更新する",
    {
      id: uuidSchema.describe("ローン ID。取得元: list_loans.items[].id"),
      ...updateLoanPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
      const loan = await apiClient.put<Loan>(`/api/loans/${id}`, payload as UpdateLoanPayload);
      return textContent(`ローンを更新しました: ${loan.name}`, { item: { ...compactRecord({ ...loan, account: accounts.find((account) => account.id === loan.accountId) ?? null }), startDate: loan.startDate.slice(0, 10) } });
    },
  );

  registerTool(server,
    "delete_loan",
    "ローンを削除する。confirm が true でない場合は API の DELETE を呼ばず、対象ローンの要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("ローン ID。取得元: list_loans.items[].id"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const loans = await apiClient.get<LoansResponse>("/api/loans");
        const loan = loans.find((entry) => entry.id === id);
        return deletePreview(
          "ローン",
          id,
          loan ? `${loan.name}（総額 ${formatCurrency(loan.totalAmount, compactRecord(loan).currencyCode)}、残 ${loan.remainingPayments}回）` : null,
        );
      }

      await apiClient.delete(`/api/loans/${id}`);
      return textContent(`ローンを削除しました: ${id}`, { id, deleted: true, executed: true });
    },
  );
}
