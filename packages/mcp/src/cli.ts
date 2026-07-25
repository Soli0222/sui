export type TransportMode = "stdio" | "sse" | "streamable-http";

export interface CliOptions {
  transport: TransportMode;
  address: string;
  basePath: string;
  endpointPath: string;
  help: boolean;
}

const DEFAULT_TRANSPORT = "stdio";
const DEFAULT_ADDRESS = "localhost:8000";
const DEFAULT_BASE_PATH = "";
const DEFAULT_ENDPOINT_PATH = "/mcp";

function readValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseTransport(value: string): TransportMode {
  if (value === "stdio" || value === "sse" || value === "streamable-http") {
    return value;
  }
  throw new Error(`Unsupported transport: ${value}`);
}

function normalizeBasePath(path: string) {
  if (!path || path === "/") {
    return "";
  }
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeEndpointPath(path: string) {
  const normalized = `/${path.replace(/^\/+/, "")}`;
  return normalized.replace(/\/+$/g, "") || "/";
}

export function parseCliOptions(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const options: CliOptions = {
    transport: parseTransport(env.SUI_MCP_TRANSPORT ?? DEFAULT_TRANSPORT),
    address: env.SUI_MCP_ADDRESS ?? DEFAULT_ADDRESS,
    basePath: normalizeBasePath(env.SUI_MCP_BASE_PATH ?? DEFAULT_BASE_PATH),
    endpointPath: normalizeEndpointPath(env.SUI_MCP_ENDPOINT_PATH ?? DEFAULT_ENDPOINT_PATH),
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-t" || arg === "--transport") {
      options.transport = parseTransport(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--transport=")) {
      options.transport = parseTransport(arg.slice("--transport=".length));
      continue;
    }

    if (arg === "--address") {
      options.address = readValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--address=")) {
      options.address = arg.slice("--address=".length);
      continue;
    }

    if (arg === "--base-path") {
      options.basePath = normalizeBasePath(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--base-path=")) {
      options.basePath = normalizeBasePath(arg.slice("--base-path=".length));
      continue;
    }

    if (arg === "--endpoint-path") {
      options.endpointPath = normalizeEndpointPath(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--endpoint-path=")) {
      options.endpointPath = normalizeEndpointPath(arg.slice("--endpoint-path=".length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function helpText() {
  return `Usage: sui-mcp [options]

Options:
  -t, --transport <stdio|sse|streamable-http>  Transport type (default: stdio)
      --address <host:port>                    Listen address for HTTP transports (default: localhost:8000)
      --base-path <path>                       Base path for HTTP transports
      --endpoint-path <path>                   Streamable HTTP endpoint path (default: /mcp)
  -h, --help                                   Show this help

Environment variables:
  SUI_MCP_TRANSPORT, SUI_MCP_ADDRESS, SUI_MCP_BASE_PATH, SUI_MCP_ENDPOINT_PATH
  SUI_API_URL and SUI_API_* TLS variables configure the upstream sui API connection
`;
}
