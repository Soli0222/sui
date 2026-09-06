import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { SpendingSettings } from "@sui/shared";

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
