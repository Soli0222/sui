import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateSalaryRecordPayload, SalaryRecord, SalaryRecordsResponse, UpdateSalaryRecordPayload } from "@sui/shared";
import { z } from "zod";
import { salaryCreatePayloadShape, salaryUpdatePayloadShape } from "../../schemas/salary-records";
import type { SuiApiClient } from "../client";
import { createToolAnnotations, deletePreview, deleteToolAnnotations, readOnlyToolAnnotations, registerTool, textContent, updateToolAnnotations, uuidSchema } from "../helpers";

const yearSchema = z.number().int().min(1).max(9998);

export function registerSalaryRecordTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "list_salary_records", "給与・賞与台帳を一覧する。year は支給日の暦年", { year: yearSchema.optional() }, readOnlyToolAnnotations,
    async ({ year }) => {
      const items = await apiClient.get<SalaryRecordsResponse>(`/api/salary-records${year === undefined ? "" : `?year=${String(year).padStart(4, "0")}`}`);
      return textContent(`${items.length} 件の給与・賞与明細`, { items, complete: true, currencyCode: "JPY" });
    });
  registerTool(server, "get_salary_record", "給与・賞与明細を ID で取得する", { id: uuidSchema.describe("取得元: list_salary_records.items[].id") }, readOnlyToolAnnotations,
    async ({ id }) => {
      const item = await apiClient.get<SalaryRecord>(`/api/salary-records/${id}`);
      return textContent(`${item.paidOn} ${item.name ?? item.kind}: 額面 ${item.grossAmount} 円、手取り ${item.netAmount} 円`, { item, currencyCode: "JPY" });
    });
  registerTool(server, "create_salary_record", "給与・賞与明細を作成する。控除は還付を表す負値も指定できる。台帳は口座残高と予測に影響しない",
    salaryCreatePayloadShape, createToolAnnotations,
    async (args) => {
      const item = await apiClient.post<SalaryRecord>("/api/salary-records", args as CreateSalaryRecordPayload);
      return textContent(`給与・賞与明細を作成しました: ${item.id}`, { item, currencyCode: "JPY" });
    });
  registerTool(server, "update_salary_record", "給与・賞与明細を部分更新する。指定した項目だけを変更する",
    { id: uuidSchema.describe("取得元: list_salary_records.items[].id"), ...salaryUpdatePayloadShape }, updateToolAnnotations,
    async ({ id, ...payload }) => {
      const item = await apiClient.patch<SalaryRecord>(`/api/salary-records/${id}`, payload as UpdateSalaryRecordPayload);
      return textContent(`給与・賞与明細を更新しました: ${item.id}`, { item, currencyCode: "JPY" });
    });
  registerTool(server, "delete_salary_record", "給与・賞与明細を削除する。confirm: true の場合のみ実行する",
    { id: uuidSchema.describe("取得元: list_salary_records.items[].id"), confirm: z.boolean().optional() }, deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const item = await apiClient.get<SalaryRecord>(`/api/salary-records/${id}`);
        return deletePreview("給与・賞与明細", id, `${item.paidOn} ${item.name ?? item.kind} ${item.grossAmount} 円`, { currencyCode: "JPY" });
      }
      await apiClient.delete(`/api/salary-records/${id}`);
      return textContent(`給与・賞与明細を削除しました: ${id}`, { id, deleted: true, executed: true, currencyCode: "JPY" });
    });
}
