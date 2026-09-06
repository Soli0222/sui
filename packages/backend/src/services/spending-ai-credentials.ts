import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Prisma } from "@sui/db";
import type { SpendingSettings } from "@sui/shared";
import { prisma } from "../lib/db";
import { BadRequestError } from "../lib/http";

function encryptionKey() {
  const value = process.env.SUI_CREDENTIAL_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new BadRequestError(
      "APIキーの保存にはサーバーの暗号化鍵（SUI_CREDENTIAL_ENCRYPTION_KEY）の設定が必要です",
    );
  return Buffer.from(value, "hex");
}
export function credentialStorageReady() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
export function encryptCredential(secret: string, endpoint: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(endpoint));
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export async function spendingCredential(
  ai: NonNullable<SpendingSettings["ai"]>,
  db: Pick<Prisma.TransactionClient, "spendingAiCredential"> = prisma,
) {
  if (ai.credentialMode !== "stored")
    return process.env[ai.credentialEnv] ?? null;
  const row = await db.spendingAiCredential.findUnique({ where: { id: 1 } });
  if (!row || row.endpoint !== ai.endpoint) return null;
  try {
    const [nonce, tag, data] = row.encrypted
      .split(".")
      .map((s) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
    decipher.setAAD(Buffer.from(ai.endpoint));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new BadRequestError(
      "保存済みAPIキーを読み取れません。暗号化鍵を確認するかAPIキーを登録し直してください",
    );
  }
}
