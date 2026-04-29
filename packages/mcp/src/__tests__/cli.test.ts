import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../cli";

describe("parseCliOptions", () => {
  it("defaults to stdio transport", () => {
    expect(parseCliOptions([], {})).toMatchObject({
      transport: "stdio",
      address: "localhost:8000",
      basePath: "",
      endpointPath: "/mcp",
      help: false,
    });
  });

  it("parses Grafana-style HTTP transport flags", () => {
    expect(
      parseCliOptions(
        ["-t", "sse", "--address", ":9090", "--base-path", "/sui/", "--endpoint-path=/rpc/"],
        {},
      ),
    ).toMatchObject({
      transport: "sse",
      address: ":9090",
      basePath: "/sui",
      endpointPath: "/rpc",
    });
  });

  it("allows environment defaults", () => {
    expect(
      parseCliOptions([], {
        SUI_MCP_TRANSPORT: "streamable-http",
        SUI_MCP_ADDRESS: "0.0.0.0:8080",
        SUI_MCP_BASE_PATH: "mcp",
      }),
    ).toMatchObject({
      transport: "streamable-http",
      address: "0.0.0.0:8080",
      basePath: "/mcp",
    });
  });

  it("rejects unsupported transports", () => {
    expect(() => parseCliOptions(["--transport", "websocket"], {})).toThrow("Unsupported transport");
  });
});
