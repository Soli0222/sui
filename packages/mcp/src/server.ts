import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SuiApiClient } from "./api-client";
import { registerMonthlyReportPrompt } from "./prompts/monthly-report";
import { registerAnalysisPrompts } from "./prompts/budget-advice";
import { registerDataResources } from "./resources/accounts";
import { registerDashboardResources } from "./resources/dashboard";
import { registerForecastResources } from "./resources/forecast";
import { registerAccountTools } from "./tools/accounts";
import { registerBillingTools } from "./tools/billings";
import { registerCreditCardTools } from "./tools/credit-cards";
import { registerDashboardTools } from "./tools/dashboard";
import { registerLoanTools } from "./tools/loans";
import { registerRecurringItemTools } from "./tools/recurring-items";
import { registerTransactionTools } from "./tools/transactions";

interface BuildServerOptions {
  apiClient: SuiApiClient;
  name?: string;
  version?: string;
}

export function buildServer({
  apiClient,
  name = "@soli0222/sui-mcp",
  version = "1.0.0",
}: BuildServerOptions) {
  const server = new McpServer({ name, version });

  registerDashboardTools(server, apiClient);
  registerAccountTools(server, apiClient);
  registerTransactionTools(server, apiClient);
  registerRecurringItemTools(server, apiClient);
  registerCreditCardTools(server, apiClient);
  registerBillingTools(server, apiClient);
  registerLoanTools(server, apiClient);

  registerDashboardResources(server, apiClient);
  registerDataResources(server, apiClient);
  registerForecastResources(server, apiClient);

  registerMonthlyReportPrompt(server, apiClient);
  registerAnalysisPrompts(server, apiClient);

  return server;
}
