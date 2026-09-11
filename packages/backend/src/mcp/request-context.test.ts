import { describe, expect, it } from "vitest";
import { InternalAuthBridge } from "./internal-auth";
import { McpRequestContext, type McpRequestAuth } from "./request-context";

describe("MCP request authentication context", () => {
  it("keeps parallel request contexts independent", async () => {
    const context = new McpRequestContext();
    const first: McpRequestAuth = { kind: "disabled", ownerKey: "first" };
    const second: McpRequestAuth = { kind: "disabled", ownerKey: "second" };
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });

    const firstResult = context.run(first, async () => {
      await barrier;
      return context.current()?.ownerKey;
    });
    const secondResult = context.run(second, async () => {
      release();
      await Promise.resolve();
      return context.current()?.ownerKey;
    });

    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual(["first", "second"]);
    expect(context.current()).toBeUndefined();
  });

  it("exposes internal auth only for the registered Request and removes it afterward", async () => {
    const bridge = new InternalAuthBridge();
    const otherBridge = new InternalAuthBridge();
    const request = new Request("http://localhost/api/accounts");
    const otherRequest = new Request(request);
    const auth = { kind: "oauth" as const, readOnly: true, subject: "sub" };

    await bridge.run(request, auth, async () => {
      expect(bridge.get(request)).toEqual(auth);
      expect(bridge.get(otherRequest)).toBeUndefined();
      expect(otherBridge.get(request)).toBeUndefined();
    });
    expect(bridge.get(request)).toBeUndefined();
  });
});
