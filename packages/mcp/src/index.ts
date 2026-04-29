import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fetch as undiciFetch } from "undici";
import { SuiApiClient } from "./api-client";
import { buildServer } from "./server";
import { buildMtlsDispatcher } from "./tls";

const apiBaseUrl = process.env.SUI_API_URL ?? "http://localhost:3000";
const dispatcher = buildMtlsDispatcher();
const apiClient = new SuiApiClient(
  apiBaseUrl,
  dispatcher ? (undiciFetch as unknown as typeof fetch) : fetch,
  dispatcher,
);
const server = buildServer({ apiClient });
const transport = new StdioServerTransport();

await server.connect(transport);
