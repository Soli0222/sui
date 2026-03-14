import type { Hono } from "hono";
import { createApp } from "../app";

type JsonBody = Record<string, unknown> | Array<unknown>;

function createJsonRequest(method: string, path: string, body?: JsonBody) {
  return {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

export function createTestApp() {
  return createApp({ enableStaticFallback: false });
}

export function createTestClient(app: Hono = createTestApp()) {
  return {
    app,
    get(path: string) {
      return app.request(path);
    },
    post(path: string, body?: JsonBody) {
      return app.request(path, createJsonRequest("POST", path, body));
    },
    put(path: string, body?: JsonBody) {
      return app.request(path, createJsonRequest("PUT", path, body));
    },
    delete(path: string) {
      return app.request(path, createJsonRequest("DELETE", path));
    },
  };
}

export async function parseJson<T>(response: Response) {
  return (await response.json()) as T;
}
