import { afterEach, expect, it, vi } from "vitest";
import {
  assertSpendingAiDestination,
  requestSpendingDecision,
} from "./spending-ai";

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dnsLookup }));

afterEach(() => {
  dnsLookup.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["chat-completions", "anthropic"] as const)(
  "%s SDK aborts a stalled request within the review deadline",
  async (protocol) => {
    vi.useFakeTimers();
    const transport = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", transport);
    const result = expect(
      requestSpendingDecision({ ...config, protocol }, "key", "rules", "data"),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(45001);
    await result;
    expect(transport).toHaveBeenCalledTimes(1);
  },
);

const config = {
  endpoint: "https://8.8.8.8/gateway/custom?version=test",
  model: "synthetic-model",
  credentialEnv: "SUI_SPENDING_AI_TEST",
  protocol: "chat-completions" as const,
};

it.each([
  "http://127.0.0.1/v1/chat/completions",
  "http://169.254.169.254/latest/meta-data",
  "http://10.0.0.5/internal",
  "http://[::1]/internal",
  "http://[::ffff:8.8.8.8]/internal",
])("rejects private AI destination %s", async (endpoint) => {
  await expect(
    assertSpendingAiDestination({ ...config, endpoint }, endpoint),
  ).rejects.toThrow("プライベート");
});

it("binds known providers to their official HTTPS origin", async () => {
  await expect(
    assertSpendingAiDestination(
      { ...config, provider: "openai" },
      "https://example.com/v1/models",
    ),
  ).rejects.toThrow("公式接続先");
});

it.each(["chat-completions", "anthropic"] as const)(
  "%s SDK preserves endpoint, credentials, model and transport policy",
  async (protocol) => {
    vi.stubEnv("OPENAI_ORG_ID", "unrelated-org");
    vi.stubEnv("OPENAI_PROJECT_ID", "unrelated-project");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unrelated-token");
    const output = '{"decision":"held"}';
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            protocol === "anthropic"
              ? { content: [{ type: "text", text: output }] }
              : { choices: [{ message: { content: output } }] },
          ),
        ),
    );
    vi.stubGlobal("fetch", transport);
    expect(
      await requestSpendingDecision(
        { ...config, protocol },
        "synthetic-key",
        "system rules",
        "untrusted data",
      ),
    ).toBe(output);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe(config.endpoint);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(
      headers.get(protocol === "anthropic" ? "x-api-key" : "authorization"),
    ).toBe(protocol === "anthropic" ? "synthetic-key" : "Bearer synthetic-key");
    expect(headers.get("openai-organization")).toBeNull();
    expect(headers.get("openai-project")).toBeNull();
    if (protocol === "anthropic") {
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
    }
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(config.model);
    expect(body.messages.at(-1).content).toBe("untrusted data");
    expect(body.tools).toBeUndefined();
    expect(String(init.body)).not.toContain("synthetic-key");
  },
);

it.each(["chat-completions", "anthropic"] as const)(
  "%s SDK does not automatically retry errors and rejects oversized output",
  async (protocol) => {
    const transport = vi.fn(
      async () => new Response('{"error":"synthetic"}', { status: 429 }),
    );
    vi.stubGlobal("fetch", transport);
    const run = () =>
      requestSpendingDecision({ ...config, protocol }, "key", "rules", "data");
    await expect(run()).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue(new Response("x".repeat(100001)));
    await expect(run()).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  },
);

it.each(["8.8.8.8", "2606:4700:4700::1111"])(
  "allows public AI destination %s",
  async (address) => {
    const host = address.includes(":") ? `[${address}]` : address;
    await expect(
      assertSpendingAiDestination(config, `https://${host}/v1/models`),
    ).resolves.toBeUndefined();
  },
);

it("rejects DNS results containing a private address before transport", async () => {
  dnsLookup.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.5", family: 4 },
  ]);
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  await expect(
    requestSpendingDecision(
      { ...config, endpoint: "https://synthetic.invalid/chat" },
      "synthetic-key",
      "rules",
      "data",
    ),
  ).rejects.toThrow("プライベート");
  expect(transport).not.toHaveBeenCalled();
});
