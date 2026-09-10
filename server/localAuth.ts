import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";
import { localAccounts, localSessions, tenantConnections, users, type TenantConnection, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { encryptCredential } from "./credentialVault";
import { ENV } from "./_core/env";

const scrypt = promisify(scryptCallback);
export const LOCAL_SESSION_COOKIE = "porterline_local_session";
const SESSION_MS = 1000 * 60 * 60 * 8;
const REMEMBER_SESSION_MS = 1000 * 60 * 60 * 24 * 7;
const LOCKOUT_MS = 1000 * 60 * 15;
const fallbackAccounts = new Map<string, { username: string; passwordHash: string; role: "admin" | "user"; displayName: string; mustChangePassword: boolean; failedAttempts: number; lockedUntil?: number }>();
const fallbackSessions = new Map<string, { username: string; expiresAt: number }>();
const fallbackConnections = new Map<string, TenantConnection>();

export type PublicTenantConnection = Omit<TenantConnection, "clientSecretCiphertext"> & { hasClientSecret: boolean };

export function validatePasswordPolicy(password: string) {
  return password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

function toPublicConnection(connection: TenantConnection): PublicTenantConnection {
  const { clientSecretCiphertext, ...publicConnection } = connection;
  return { ...publicConnection, hasClientSecret: Boolean(clientSecretCiphertext) };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, salt, expectedHex] = stored.split("$");
  if (!salt || !expectedHex) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function toUser(account: { username: string; displayName: string; role: "admin" | "user"; id?: number; email?: string | null; createdAt?: Date; updatedAt?: Date; lastLoginAt?: Date | null }): User {
  const now = new Date();
  return { id: account.id ?? 0, openId: `local:${account.username}`, name: account.displayName, email: account.email ?? null, loginMethod: "local", role: account.role, createdAt: account.createdAt ?? now, updatedAt: account.updatedAt ?? now, lastSignedIn: account.lastLoginAt ?? now };
}

export async function ensureBootstrapAdmin() {
  const password = ENV.bootstrapAdminPassword;
  if (!password) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be configured before starting in production");
  if (ENV.isProduction && !ENV.credentialEncryptionKey) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be configured before starting in production");
  const db = await getDb();
  if (!db) {
    if (!fallbackAccounts.has("admin")) fallbackAccounts.set("admin", { username: "admin", passwordHash: await hashPassword(password), role: "admin", displayName: "Platform administrator", mustChangePassword: true, failedAttempts: 0 });
    return;
  }
  const existing = await db.select().from(localAccounts).where(eq(localAccounts.username, "admin")).limit(1);
  if (!existing[0]) await db.insert(localAccounts).values({ username: "admin", displayName: "Platform administrator", passwordHash: await hashPassword(password), role: "admin", mustChangePassword: 1, failedAttempts: 0 });
}

export async function loginLocal(username: string, password: string, metadata: { ipAddress?: string; userAgent?: string; rememberMe?: boolean }) {
  await ensureBootstrapAdmin();
  const normalized = username.trim().toLowerCase();
  const db = await getDb();
  if (!db) {
    const account = fallbackAccounts.get(normalized);
    if (!account) return { ok: false as const, error: "Invalid username or password" };
    if (account.lockedUntil && account.lockedUntil > Date.now()) return { ok: false as const, error: "Account temporarily locked. Try again later." };
    if (!(await verifyPassword(password, account.passwordHash))) {
      account.failedAttempts += 1;
      if (account.failedAttempts >= 5) { account.failedAttempts = 0; account.lockedUntil = Date.now() + LOCKOUT_MS; }
      return { ok: false as const, error: "Invalid username or password" };
    }
    account.failedAttempts = 0; account.lockedUntil = undefined;
    const token = randomBytes(32).toString("base64url");
    fallbackSessions.set(hashToken(token), { username: normalized, expiresAt: Date.now() + (metadata.rememberMe ? REMEMBER_SESSION_MS : SESSION_MS) });
    return { ok: true as const, token, user: toUser(account), mustChangePassword: account.mustChangePassword };
  }
  const rows = await db.select().from(localAccounts).where(eq(localAccounts.username, normalized)).limit(1);
  const account = rows[0];
  if (!account) return { ok: false as const, error: "Invalid username or password" };
  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) return { ok: false as const, error: "Account temporarily locked. Try again later." };
  if (!(await verifyPassword(password, account.passwordHash))) {
    const attempts = account.failedAttempts + 1;
    await db.update(localAccounts).set({ failedAttempts: attempts >= 5 ? 0 : attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + LOCKOUT_MS) : null }).where(eq(localAccounts.id, account.id));
    return { ok: false as const, error: "Invalid username or password" };
  }
  const token = randomBytes(32).toString("base64url");
  await db.update(localAccounts).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(localAccounts.id, account.id));
  await db.insert(localSessions).values({ id: hashToken(token), accountId: account.id, expiresAt: new Date(Date.now() + (metadata.rememberMe ? REMEMBER_SESSION_MS : SESSION_MS)), ipAddress: metadata.ipAddress, userAgent: metadata.userAgent });
  return { ok: true as const, token, user: toUser({ ...account, lastLoginAt: new Date() }), mustChangePassword: Boolean(account.mustChangePassword) };
}

export async function getLocalUserFromToken(token: string | undefined) {
  if (!token) return null;
  const db = await getDb();
  if (!db) {
    const session = fallbackSessions.get(hashToken(token));
    if (!session || session.expiresAt < Date.now()) return null;
    const account = fallbackAccounts.get(session.username);
    return account ? toUser(account) : null;
  }
  const rows = await db.select({ account: localAccounts }).from(localSessions).innerJoin(localAccounts, eq(localSessions.accountId, localAccounts.id)).where(and(eq(localSessions.id, hashToken(token)), isNull(localSessions.revokedAt), gt(localSessions.expiresAt, new Date()))).limit(1);
  return rows[0]?.account ? toUser(rows[0].account) : null;
}

export async function revokeLocalSession(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  if (!db) { fallbackSessions.delete(hashToken(token)); return; }
  await db.update(localSessions).set({ revokedAt: new Date() }).where(eq(localSessions.id, hashToken(token)));
}

export async function listTenantConnections(ownerOpenId: string): Promise<PublicTenantConnection[]> {
  const db = await getDb();
  if (!db) return Array.from(fallbackConnections.values()).filter(item => item.ownerOpenId === ownerOpenId).map(toPublicConnection);
  return (await db.select().from(tenantConnections).where(eq(tenantConnections.ownerOpenId, ownerOpenId))).map(toPublicConnection);
}

export async function createTenantConnection(input: { ownerOpenId: string; label: string; direction: "source" | "target"; tenantId: string; clientId?: string; clientSecret?: string; siteUrl?: string }) {
  const connection = { id: `TEN-${randomBytes(5).toString("hex")}`, ownerOpenId: input.ownerOpenId, label: input.label, direction: input.direction, tenantId: input.tenantId, clientId: input.clientId ?? null, clientSecretCiphertext: encryptCredential(input.clientSecret ?? ""), siteUrl: input.siteUrl ?? null, status: "Draft" as const };
  const db = await getDb();
  if (!db) { const now = new Date(); const value = { ...connection, createdAt: now, updatedAt: now }; fallbackConnections.set(connection.id, value); return toPublicConnection(value); }
  await db.insert(tenantConnections).values(connection);
  const rows = await db.select().from(tenantConnections).where(eq(tenantConnections.id, connection.id)).limit(1);
  return rows[0] ? toPublicConnection(rows[0]) : undefined;
}

export async function getTenantConnection(ownerOpenId: string, id: string) {
  const db = await getDb();
  if (!db) return Array.from(fallbackConnections.values()).find(item => item.id === id && item.ownerOpenId === ownerOpenId) ?? null;
  const rows = await db.select().from(tenantConnections).where(and(eq(tenantConnections.id, id), eq(tenantConnections.ownerOpenId, ownerOpenId))).limit(1);
  return rows[0] ?? null;
}

export async function updateTenantConnectionStatus(ownerOpenId: string, id: string, status: "Draft" | "Connected" | "Error") {
  const db = await getDb();
  if (!db) {
    const existing = await getTenantConnection(ownerOpenId, id);
    if (!existing) return null;
    const updated = { ...existing, status, updatedAt: new Date() };
    fallbackConnections.set(id, updated);
    return toPublicConnection(updated);
  }
  await db.update(tenantConnections).set({ status, updatedAt: new Date() }).where(and(eq(tenantConnections.id, id), eq(tenantConnections.ownerOpenId, ownerOpenId)));
  const updated = await getTenantConnection(ownerOpenId, id);
  return updated ? toPublicConnection(updated) : null;
}
