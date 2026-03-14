import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SuiApiClient } from "./api-client";
import { buildServer } from "./server";

const apiBaseUrl = process.env.SUI_API_URL ?? "http://localhost:3000";
const apiClient = new SuiApiClient(apiBaseUrl);
const server = buildServer({ apiClient });
const transport = new StdioServerTransport();

await server.connect(transport);
