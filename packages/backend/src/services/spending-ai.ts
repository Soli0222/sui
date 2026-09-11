import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { SpendingSettings } from "@sui/shared";

// Keep families separate: Node matches IPv4 against mapped IPv6 subnets too.
const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedIpv4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blockedIpv6.addSubnet(address, prefix, "ipv6");

const providerOrigins = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
} as const;

export async function assertSpendingAiDestination(
  ai: NonNullable<SpendingSettings["ai"]>,
  value: string,
) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("AI接続先が安全ではありません");
  const approved =
    ai.provider &&
    providerOrigins[ai.provider as keyof typeof providerOrigins];
  if (approved && url.origin !== approved)
    throw new Error("AI事業者の公式接続先を指定してください");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address, family }) =>
      family === 6
        ? blockedIpv6.check(address, "ipv6")
        : blockedIpv4.check(address, "ipv4"),
    )
  )
    throw new Error("ローカルまたはプライベートなAI接続先は使用できません");
}

// Keep transport policy independent of the provider's request/response schema.
const boundedFetch: typeof fetch = async (url, init) => {
  const response = await fetch(url, { ...init, redirect: "error" });
  const raw = await response.text();
  if (raw.length > 100000) throw new Error("AI response too large");
  const headers = new Headers(response.headers);
  // Compatible endpoints have historically been allowed to omit Content-Type.
  headers.set("content-type", "application/json");
  return new Response(raw, { status: response.status, headers });
};

export async function requestSpendingDecision(
  ai: NonNullable<SpendingSettings["ai"]>,
  credential: string,
  system: string,
  input: string,
): Promise<string> {
  await assertSpendingAiDestination(ai, ai.endpoint);
  const options = {
    apiKey: credential,
    baseURL: new URL(ai.endpoint).origin,
    timeout: 45000,
    maxRetries: 0,
    fetch: boundedFetch,
    logLevel: "off" as const,
  };
  // Preserve the configured full URL, including gateway paths and query strings.
  const request = { path: ai.endpoint, signal: AbortSignal.timeout(45000) };
  if (ai.protocol === "anthropic") {
    const client = new Anthropic({ ...options, authToken: null });
    const response = await client.messages.create(
      {
        model: ai.model,
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: input }],
      },
      request,
    );
    const content = response.content.find((block) => block.type === "text");
    if (!content) throw new Error("Missing AI text output");
    return content.text;
  }
  const client = new OpenAI({ ...options, organization: null, project: null });
  const response = await client.chat.completions.create(
    {
      model: ai.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    },
    request,
  );
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("Missing AI text output");
  return content;
}

export async function listSpendingModels(
  ai: NonNullable<SpendingSettings["ai"]>,
  credential: string,
) {
  const options = {
    apiKey: credential,
    baseURL: new URL(ai.endpoint).origin,
    fetch: boundedFetch,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off" as const,
  };
  const path =
    ai.modelsEndpoint ||
    (ai.provider === "openai"
      ? "https://api.openai.com/v1/models"
      : ai.provider === "anthropic"
        ? "https://api.anthropic.com/v1/models"
        : ai.endpoint.replace(
            /\/(chat\/completions|messages)(\?.*)?$/,
            "/models",
          ));
  if (
    path === ai.endpoint ||
    new URL(path).origin !== new URL(ai.endpoint).origin
  )
    throw new Error("モデル一覧URLを同じ接続先で設定してください");
  await assertSpendingAiDestination(ai, path);
  const request = { path, signal: AbortSignal.timeout(15000) };
  if (ai.protocol === "anthropic") {
    const client = new Anthropic({ ...options, authToken: null });
    const result: { id: string; name: string }[] = [];
    let page = await client.models.list({ limit: 100 }, request);
    for (let n = 0; n < 20; n++) {
      result.push(
        ...page.data.map((m) => ({ id: m.id, name: m.display_name })),
      );
      if (!page.hasNextPage()) return result;
      page = await page.getNextPage();
    }
    throw new Error("モデル一覧が多すぎます。モデルIDを直接入力してください");
  }
  const client = new OpenAI({ ...options, organization: null, project: null });
  const page = await client.models.list(request);
  return page.data.map((m) => ({ id: m.id, name: m.id }));
}
