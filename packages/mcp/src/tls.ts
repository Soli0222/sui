import { readFileSync } from "node:fs";
import { Agent, type Dispatcher } from "undici";

export interface MtlsEnv {
  SUI_API_CLIENT_CERT_PATH?: string;
  SUI_API_CLIENT_KEY_PATH?: string;
  SUI_API_CLIENT_KEY_PASSPHRASE?: string;
  SUI_API_CA_CERT_PATH?: string;
  SUI_API_TLS_REJECT_UNAUTHORIZED?: string;
}

export function buildMtlsDispatcher(env: MtlsEnv = process.env): Dispatcher | undefined {
  const certPath = env.SUI_API_CLIENT_CERT_PATH;
  const keyPath = env.SUI_API_CLIENT_KEY_PATH;
  const caPath = env.SUI_API_CA_CERT_PATH;
  const passphrase = env.SUI_API_CLIENT_KEY_PASSPHRASE;
  const rejectRaw = env.SUI_API_TLS_REJECT_UNAUTHORIZED;

  const hasClientAuth = Boolean(certPath) || Boolean(keyPath);
  const hasTlsConfig = hasClientAuth || Boolean(caPath) || rejectRaw !== undefined;
  if (!hasTlsConfig) {
    return undefined;
  }

  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error(
      "SUI_API_CLIENT_CERT_PATH と SUI_API_CLIENT_KEY_PATH は両方を指定してください",
    );
  }

  return new Agent({
    connect: {
      cert: certPath ? readFileSync(certPath) : undefined,
      key: keyPath ? readFileSync(keyPath) : undefined,
      ca: caPath ? readFileSync(caPath) : undefined,
      passphrase,
      rejectUnauthorized: rejectRaw === undefined ? undefined : rejectRaw !== "false",
    },
  });
}
