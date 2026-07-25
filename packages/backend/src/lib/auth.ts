import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

export const SESSION_COOKIE_NAME = "sui_session";
export const SESSION_TOKEN_PREFIX = "sui_sess_";
export const API_TOKEN_PREFIX = "sui_tok_";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const API_TOKEN_LAST_USED_THROTTLE_MS = 60 * 1000;

export interface AuthInfo {
  kind: "session" | "token";
  readOnly: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthInfo;
    authMode: "enabled" | "disabled";
  }
}

export function generateToken(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken() {
  return generateToken(SESSION_TOKEN_PREFIX);
}

export function generateApiToken() {
  return generateToken(API_TOKEN_PREFIX);
}

export async function createAuthSession(subject: string, userAgent?: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  const session = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(token),
      subject,
      userAgent,
      expiresAt,
    },
  });
  return { token, session };
}

export async function verifyAuthSession(token: string) {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  const now = new Date();
  if (session.lastUsedAt.getTime() + API_TOKEN_LAST_USED_THROTTLE_MS <= now.getTime()) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  }

  return session;
}

export async function deleteAuthSession(token: string) {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (session) {
    await prisma.authSession.delete({ where: { id: session.id } });
  }
  return session;
}

export async function createApiTokenRecord(name: string, readOnly = false) {
  const token = generateApiToken();
  const record = await prisma.apiToken.create({
    data: {
      name,
      tokenHash: hashToken(token),
      readOnly,
    },
  });
  return { token, record };
}

export async function verifyApiToken(token: string) {
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.revokedAt) {
    return null;
  }

  const now = new Date();
  if (!record.lastUsedAt || record.lastUsedAt.getTime() + API_TOKEN_LAST_USED_THROTTLE_MS <= now.getTime()) {
    await prisma.apiToken.update({
      where: { id: record.id },
      data: { lastUsedAt: now },
    });
  }

  return record;
}

export async function revokeApiToken(id: string) {
  const record = await prisma.apiToken.findUnique({ where: { id } });
  if (!record) {
    return null;
  }
  return prisma.apiToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export async function listApiTokens() {
  const records = await prisma.apiToken.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      readOnly: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return records;
}

export async function cleanupExpiredSessions() {
  await prisma.authSession.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
}
