import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { createTenantConnection, ensureBootstrapAdmin, getLocalUserFromToken, hashPassword, listTenantConnections, loginLocal, revokeLocalSession, validatePasswordPolicy, verifyPassword, LOCAL_SESSION_COOKIE } from "./localAuth";
import { eq } from "drizzle-orm";
import { localAccounts } from "../drizzle/schema";
import { getDb } from "./db";

const attempts = new Map<string, { count: number; resetAt: number }>();
function clientIp(req: Request) { return String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim(); }
function cookieOptions(secure: boolean, maxAge = 1000 * 60 * 60 * 8) { return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge }; }
function tokenFrom(req: Request) {
  const cookieToken = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${LOCAL_SESSION_COOKIE}=`))?.slice(LOCAL_SESSION_COOKIE.length + 1);
  return cookieToken ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
}
function setError(res: Response, status: number, error: string) { res.status(status).json({ ok: false, error }); }

export function registerLocalAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req, res) => {
    const ip = clientIp(req);
    const state = attempts.get(ip) ?? { count: 0, resetAt: Date.now() + 60_000 };
    if (state.resetAt < Date.now()) { state.count = 0; state.resetAt = Date.now() + 60_000; }
    if (state.count >= 20) return setError(res, 429, "Too many login attempts. Try again later.");
    state.count += 1; attempts.set(ip, state);
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const rememberMe = req.body?.rememberMe === true;
    if (!username || !password) return setError(res, 400, "Username and password are required.");
    const result = await loginLocal(username, password, { ipAddress: ip, userAgent: req.get("user-agent"), rememberMe });
    if (!result.ok) return setError(res, 401, result.error);
    attempts.delete(ip);
    res.cookie(LOCAL_SESSION_COOKIE, result.token, cookieOptions(process.env.NODE_ENV === "production", rememberMe ? 1000 * 60 * 60 * 24 * 7 : undefined));
    return res.json({ ok: true, user: result.user, mustChangePassword: result.mustChangePassword });
  });

  app.post("/api/auth/logout", async (req, res) => {
    await revokeLocalSession(tokenFrom(req));
    res.clearCookie(LOCAL_SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = await getLocalUserFromToken(tokenFrom(req));
    if (!user) return setError(res, 401, "Not authenticated");
    res.json({ ok: true, user });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    const user = await getLocalUserFromToken(tokenFrom(req));
    if (!user || !user.openId.startsWith("local:")) return setError(res, 401, "Not authenticated");
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!validatePasswordPolicy(newPassword)) return setError(res, 400, "New password must be at least 12 characters with upper, lower, number, and symbol.");
    const db = await getDb();
    if (!db) return setError(res, 503, "Password changes require a configured database.");
    const accountId = Number(user.id);
    const rows = await db.select().from(localAccounts).where(eq(localAccounts.id, accountId)).limit(1);
    if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].passwordHash))) return setError(res, 401, "Current password is incorrect.");
    await db.update(localAccounts).set({ passwordHash: await hashPassword(newPassword), mustChangePassword: 0, updatedAt: new Date() }).where(eq(localAccounts.id, accountId));
    res.json({ ok: true });
  });

  app.get("/api/workspace/tenant-connections", async (req, res) => {
    const user = await getLocalUserFromToken(tokenFrom(req));
    if (!user) return setError(res, 401, "Not authenticated");
    res.json({ ok: true, connections: await listTenantConnections(user.openId) });
  });

  app.post("/api/workspace/tenant-connections", async (req, res) => {
    const user = await getLocalUserFromToken(tokenFrom(req));
    if (!user) return setError(res, 401, "Not authenticated");
    const { label, direction, tenantId, clientId, siteUrl } = req.body ?? {};
    if (typeof label !== "string" || !label.trim() || !["source", "target"].includes(direction) || typeof tenantId !== "string" || !tenantId.trim()) return setError(res, 400, "Label, direction, and tenant ID are required.");
    const connection = await createTenantConnection({ ownerOpenId: user.openId, label: label.trim(), direction, tenantId: tenantId.trim(), clientId: typeof clientId === "string" ? clientId.trim() : undefined, siteUrl: typeof siteUrl === "string" ? siteUrl.trim() : undefined });
    res.status(201).json({ ok: true, connection });
  });
}
