import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateDonationPayload, Donation, DonationsResponse, UpdateDonationPayload } from "@sui/shared";
import { z } from "zod";
import { donationCreatePayloadShape, donationUpdatePayloadShape } from "../../routes/donations";
import type { SuiApiClient } from "../client";
import { createToolAnnotations, deletePreview, deleteToolAnnotations, readOnlyToolAnnotations, registerTool, textContent, updateToolAnnotations, uuidSchema } from "../helpers";

const yearSchema = z.number().int().min(1).max(9998);

export function registerDonationTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "list_donations", "ふるさと納税の寄付台帳を一覧する。year は寄付日の暦年", { year: yearSchema.optional() }, readOnlyToolAnnotations,
    async ({ year }) => {
      const items = await apiClient.get<DonationsResponse>(`/api/donations${year === undefined ? "" : `?year=${String(year).padStart(4, "0")}`}`);
      return textContent(`${items.length} 件の寄付`, { items, complete: true, currencyCode: "JPY" });
    });
  registerTool(server, "create_donation", "ふるさと納税の寄付記録を作成する。口座残高や予測には反映しない",
    donationCreatePayloadShape, createToolAnnotations,
    async (args) => {
      const item = await apiClient.post<Donation>("/api/donations", args as CreateDonationPayload);
      return textContent(`寄付を記録しました: ${item.id}`, { item, currencyCode: "JPY" });
    });
  registerTool(server, "update_donation", "寄付記録を部分更新する。指定した項目だけを変更する",
    { id: uuidSchema.describe("取得元: list_donations.items[].id"), ...donationUpdatePayloadShape }, updateToolAnnotations,
    async ({ id, ...payload }) => {
      const item = await apiClient.patch<Donation>(`/api/donations/${id}`, payload as UpdateDonationPayload);
      return textContent(`寄付を更新しました: ${item.id}`, { item, currencyCode: "JPY" });
    });
  registerTool(server, "delete_donation", "寄付記録を削除する。confirm: true の場合のみ実行する",
    { id: uuidSchema.describe("取得元: list_donations.items[].id"), confirm: z.boolean().optional() }, deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const items = await apiClient.get<DonationsResponse>("/api/donations");
        const item = items.find((entry) => entry.id === id);
        return deletePreview("寄付", id, item ? `${item.donatedOn} ${item.recipient} ${item.amount} 円` : null, { currencyCode: "JPY" });
      }
      await apiClient.delete(`/api/donations/${id}`);
      return textContent(`寄付を削除しました: ${id}`, { id, deleted: true, executed: true, currencyCode: "JPY" });
    });
}
