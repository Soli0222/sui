import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "undici";
import { buildMtlsDispatcher } from "../tls";

let workDir: string;
let certPath: string;
let keyPath: string;
let caPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "sui-mcp-tls-"));
  certPath = join(workDir, "client.crt");
  keyPath = join(workDir, "client.key");
  caPath = join(workDir, "ca.crt");
  writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----");
  writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----");
  writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("buildMtlsDispatcher", () => {
  it("returns undefined when no TLS env vars are set", () => {
    expect(buildMtlsDispatcher({})).toBeUndefined();
  });

  it("returns an undici Agent when client cert and key are provided", () => {
    const dispatcher = buildMtlsDispatcher({
      SUI_API_CLIENT_CERT_PATH: certPath,
      SUI_API_CLIENT_KEY_PATH: keyPath,
    });
    expect(dispatcher).toBeInstanceOf(Agent);
  });

  it("supports CA-only configuration without a client cert", () => {
    const dispatcher = buildMtlsDispatcher({ SUI_API_CA_CERT_PATH: caPath });
    expect(dispatcher).toBeInstanceOf(Agent);
  });

  it("respects SUI_API_TLS_REJECT_UNAUTHORIZED=false on its own", () => {
    const dispatcher = buildMtlsDispatcher({ SUI_API_TLS_REJECT_UNAUTHORIZED: "false" });
    expect(dispatcher).toBeInstanceOf(Agent);
  });

  it("throws when only the cert path is set", () => {
    expect(() =>
      buildMtlsDispatcher({ SUI_API_CLIENT_CERT_PATH: certPath }),
    ).toThrow(/SUI_API_CLIENT_CERT_PATH と SUI_API_CLIENT_KEY_PATH/);
  });

  it("throws when only the key path is set", () => {
    expect(() =>
      buildMtlsDispatcher({ SUI_API_CLIENT_KEY_PATH: keyPath }),
    ).toThrow(/SUI_API_CLIENT_CERT_PATH と SUI_API_CLIENT_KEY_PATH/);
  });

  it("throws when the cert file does not exist", () => {
    expect(() =>
      buildMtlsDispatcher({
        SUI_API_CLIENT_CERT_PATH: join(workDir, "missing.crt"),
        SUI_API_CLIENT_KEY_PATH: keyPath,
      }),
    ).toThrow();
  });
});
