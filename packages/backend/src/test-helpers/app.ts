import type { Hono } from "hono";
import { createApp, type CreateAppOptions } from "../app";

type JsonBody = Record<string, unknown> | Array<unknown>;
type RequestHeaders = Record<string, string>;

interface RequestOptions {
  headers?: RequestHeaders;
}

function createJsonRequest(method: string, body?: JsonBody, options: RequestOptions = {}) {
  const headers = { ...options.headers };
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }

  return {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

export function createTestApp(options: Omit<CreateAppOptions, "enableStaticFallback"> = {}) {
  return createApp({ ...options, enableStaticFallback: false });
}

export function createTestClient(app: Hono = createTestApp()) {
  return {
    app,
    get(path: string, options: RequestOptions = {}) {
      return app.request(path, {
        headers: options.headers,
      });
    },
    post(path: string, body?: JsonBody, options?: RequestOptions) {
      return app.request(path, createJsonRequest("POST", body, options));
    },
    put(path: string, body?: JsonBody, options?: RequestOptions) {
      return app.request(path, createJsonRequest("PUT", body, options));
    },
    delete(path: string, options?: RequestOptions) {
      return app.request(path, createJsonRequest("DELETE", undefined, options));
    },
  };
}

export async function parseJson<T>(response: Response) {
  return (await response.json()) as T;
}
