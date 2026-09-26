import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FurusatoSimulationInputPayload, FurusatoSimulationResponse } from "@sui/shared";
import { z } from "zod";
import { furusatoSimulationInputShape } from "../../schemas/furusato";
import type { SuiApiClient } from "../client";
import { readOnlyToolAnnotations, registerTool, textContent, updateToolAnnotations } from "../helpers";

const year = z.number().int().min(1).max(9998);

export function registerFurusatoTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "get_furusato_simulation", "指定年の給与・寄付実績と保存済み見込み値から、ふるさと納税控除上限の概算を取得する。令和7年の税制に基づく目安",
    { year: year.optional() }, readOnlyToolAnnotations,
    async ({ year: selectedYear }) => {
      const simulation = await apiClient.get<FurusatoSimulationResponse>(`/api/furusato/simulation${selectedYear === undefined ? "" : `?year=${String(selectedYear).padStart(4, "0")}`}`);
      return textContent(`${simulation.year} 年の寄付上限目安: ${simulation.limit} 円、寄付済み ${simulation.donations.total} 円`, { simulation, currencyCode: "JPY" });
    });
  registerTool(server, "save_furusato_simulation_input", "指定年の未支給賞与、その他所得、その他控除の見込み額を保存する。各額は円単位の非負整数",
    furusatoSimulationInputShape, updateToolAnnotations,
    async (args) => {
      const input = await apiClient.put<FurusatoSimulationInputPayload>("/api/furusato/simulation-input", args);
      return textContent(`${input.year} 年のふるさと納税試算入力を保存しました`, { input, currencyCode: "JPY" });
    });
}
