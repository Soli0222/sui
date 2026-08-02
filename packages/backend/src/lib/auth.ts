import { createHash, randomBytes } from "node:crypto";
import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AuthSession } from "@sui/db";
import { prisma } from "./db";
import { loadOidcConfig } from "./oidc";
import type { OidcConfig } from "./oidc";

export const SESSION_COOKIE_NAME = "sui_session";
export const SESSION_TOKEN_PREFIX = "sui_sess_";
export const API_TOKEN_PREFIX = "sui_tok_";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const API_TOKEN_LAST_USED_THROTTLE_MS = 60 * 1000;

export function isSecureCookie(c: Context) {
  const envValue = process.env.SUI_COOKIE_SECURE;
  if (envValue === "true" || envValue === "1") {
    return true;
  }
  if (envValue === "false" || envValue === "0") {
    return false;
  }
  return c.req.header("x-forwarded-proto") === "https";
}

export function setSessionCookie(c: Context, token: string, expiresAt?: Date) {
  const now = Date.now();
  const maxAgeSeconds = expiresAt
    ? Math.max(0, Math.min(SESSION_LIFETIME_SECONDS, Math.ceil((expiresAt.getTime() - now) / 1000)))
    : SESSION_LIFETIME_SECONDS;
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isSecureCookie(c),
    maxAge: maxAgeSeconds,
  });
}

export interface AuthInfo {
  kind: "session" | "token" | "disabled" | "none";
  readOnly: boolean;
  subject?: string;
  sessionId?: string;
  apiTokenId?: string;
  authMode?: "enabled" | "disabled";
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

export interface CreateAuthSessionInput {
  issuer: string;
  subject: string;
  email?: string;
  userAgent?: string;
}

export async function createAuthSession({ issuer, subject, email, userAgent }: CreateAuthSessionInput) {
  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_LIFETIME_MS);
  const maxExpiresAt = new Date(now + MAX_SESSION_LIFETIME_MS);
  const session = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(token),
      issuer,
      subject,
      email,
      userAgent,
      expiresAt,
      maxExpiresAt,
    },
  });
  return { token, session };
}

function isSessionAllowed(session: AuthSession, oidc: OidcConfig) {
  if (session.issuer !== oidc.issuer) {
    return false;
  }
  if (oidc.allowedSubjects.length > 0 && oidc.allowedSubjects.includes(session.subject)) {
    return true;
  }
  if (oidc.allowedEmails.length > 0 && typeof session.email === "string") {
    const normalizedAllowed = oidc.allowedEmails.map((entry) => entry.toLowerCase());
    if (normalizedAllowed.includes(session.email.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export async function verifyAuthSession(token: string): Promise<{ session: AuthSession; extended: boolean } | null> {
  const tokenHash = hashToken(token);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
  });
  const now = new Date();
  if (!session || session.expiresAt <= now || session.maxExpiresAt <= now) {
    return null;
  }

  const oidc = loadOidcConfig();
  if (!oidc || !isSessionAllowed(session, oidc)) {
    return null;
  }

  const nextExpiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  const cappedExpiresAt = nextExpiresAt > session.maxExpiresAt ? session.maxExpiresAt : nextExpiresAt;
  const shouldExtend = session.lastUsedAt.getTime() + API_TOKEN_LAST_USED_THROTTLE_MS <= now.getTime();

  if (shouldExtend) {
    const updated = await prisma.authSession.update({
      where: { id: session.id },
      data: {
        lastUsedAt: now,
        expiresAt: cappedExpiresAt,
      },
    });
    return { session: updated, extended: cappedExpiresAt.getTime() > session.expiresAt.getTime() };
  }

  return { session, extended: false };
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

export async function deleteAuthSessionById(id: string) {
  return prisma.authSession.delete({ where: { id } }).catch(() => null);
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
  const now = new Date();
  await prisma.authSession.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { maxExpiresAt: { lte: now } }] },
  });
}

export async function listAuthSessions(subject: string) {
  const now = new Date();
  return prisma.authSession.findMany({
    where: {
      subject,
      expiresAt: { gt: now },
      maxExpiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      issuer: true,
      subject: true,
      userAgent: true,
      expiresAt: true,
      maxExpiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
}

export async function getAuthSessionByIdForSubject(id: string, subject: string) {
  return prisma.authSession.findFirst({
    where: { id, subject },
  });
}

export async function revokeAuthSessions(subject: string) {
  return prisma.authSession.deleteMany({
    where: { subject },
  });
}
