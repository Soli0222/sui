import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fetch as undiciFetch } from "undici";
import { SuiApiClient } from "./api-client";
import { helpText, parseCliOptions } from "./cli";
import { startHttpServer } from "./http-server";
import { buildServer } from "./server";
import { buildMtlsDispatcher } from "./tls";

const options = parseCliOptions(process.argv.slice(2));
if (options.help) {
  console.log(helpText());
  process.exit(0);
}

const apiBaseUrl = process.env.SUI_API_URL ?? "http://localhost:3000";
const dispatcher = buildMtlsDispatcher();
const apiClient = new SuiApiClient(
  apiBaseUrl,
  dispatcher ? (undiciFetch as unknown as typeof fetch) : fetch,
  dispatcher,
);

if (options.transport === "stdio") {
  const server = buildServer({ apiClient });
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  await startHttpServer(options, apiClient);
}
