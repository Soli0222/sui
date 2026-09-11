import { AsyncLocalStorage } from "node:async_hooks";
import type { McpOAuthPrincipal } from "../lib/mcp-oauth";

export type McpRequestAuth =
  | {
    readonly kind: "apiToken";
    readonly ownerKey: string;
    readonly token: string;
    readonly tokenId: string;
    readonly readOnly: boolean;
  }
  | {
    readonly kind: "oauth";
    readonly ownerKey: string;
    readonly principal: McpOAuthPrincipal;
  }
  | {
    readonly kind: "disabled";
    readonly ownerKey: string;
  };

export class McpRequestContext {
  private readonly storage = new AsyncLocalStorage<McpRequestAuth>();

  run<T>(auth: McpRequestAuth, callback: () => T): T {
    return this.storage.run(auth, callback);
  }

  current() {
    return this.storage.getStore();
  }
}
