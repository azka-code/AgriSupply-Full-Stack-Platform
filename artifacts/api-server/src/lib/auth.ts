import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SignJWT, jwtVerify } from "jose";
import type { Request, RequestHandler, Response } from "express";
import { db } from "../db";

export type Role = "FARMER" | "TRANSPORTER" | "WAREHOUSE_ADMIN" | "RETAILER";

export interface AppUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  organizationId: number;
  organizationName: string;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  organization_id: number;
  organization_name: string;
  password_hash?: string;
}

declare global {
  namespace Express {
    interface Locals {
      user?: AppUser;
    }
  }
}

const getSecret = (): Uint8Array => {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return new TextEncoder().encode(configured);

  const dataDir = resolve(process.cwd(), "data");
  const secretFile = resolve(dataDir, "session-secret");
  mkdirSync(dirname(secretFile), { recursive: true });
  if (!existsSync(secretFile)) {
    writeFileSync(secretFile, randomBytes(48).toString("base64url"), { mode: 0o600 });
  }
  return new TextEncoder().encode(readFileSync(secretFile, "utf8").trim());
};

const secret = getSecret();
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function findUserById(userId: number): AppUser | null {
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.organization_id, o.name AS organization_name
    FROM users u
    JOIN organizations o ON o.id = u.organization_id
    WHERE u.id = ?
  `).get(userId) as UserRow | undefined;
  return row ? toAppUser(row) : null;
}

function toAppUser(row: UserRow): AppUser {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    organizationId: Number(row.organization_id),
    organizationName: row.organization_name,
  };
}

export function publicUser(user: AppUser): AppUser {
  return user;
}

function cookieOptions(req: Request, maxAge: number) {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: req.secure || forwardedProto === "https",
    path: "/",
    maxAge,
  };
}

async function createTokens(user: AppUser) {
  const now = Math.floor(Date.now() / 1000);
  const access = await new SignJWT({
    organizationId: user.organizationId,
    role: user.role,
    kind: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(now + 15 * 60)
    .sign(secret);
  const refreshId = randomUUID();
  const refresh = await new SignJWT({ kind: "refresh", tokenId: refreshId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(now + 7 * 24 * 60 * 60)
    .sign(secret);
  return { access, refresh, refreshId };
}

export async function startSession(req: Request, res: Response, user: AppUser): Promise<void> {
  const tokens = await createTokens(user);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  db.prepare("INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(tokens.refresh), user.id, expiresAt);
  res.cookie("as_access", tokens.access, cookieOptions(req, 15 * 60_000));
  res.cookie("as_refresh", tokens.refresh, cookieOptions(req, 7 * 24 * 60 * 60_000));
}

export async function rotateSession(req: Request, res: Response): Promise<AppUser | null> {
  const oldToken = req.cookies?.as_refresh as string | undefined;
  if (!oldToken) return null;

  try {
    const { payload } = await jwtVerify(oldToken, secret, { algorithms: ["HS256"] });
    if (payload.kind !== "refresh" || typeof payload.sub !== "string") return null;
    const stored = db.prepare(`
      SELECT user_id FROM refresh_tokens
      WHERE token_hash = ? AND expires_at > ?
    `).get(hashToken(oldToken), new Date().toISOString()) as { user_id: number } | undefined;
    if (!stored) return null;

    const user = findUserById(Number(stored.user_id));
    if (!user) return null;
    const tokens = await createTokens(user);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const rotate = db.transaction(() => {
      db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(hashToken(oldToken));
      db.prepare("INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .run(hashToken(tokens.refresh), user.id, expiresAt);
    });
    rotate();
    res.cookie("as_access", tokens.access, cookieOptions(req, 15 * 60_000));
    res.cookie("as_refresh", tokens.refresh, cookieOptions(req, 7 * 24 * 60 * 60_000));
    return user;
  } catch {
    return null;
  }
}

export function clearSession(req: Request, res: Response): void {
  const refresh = req.cookies?.as_refresh as string | undefined;
  if (refresh) db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(hashToken(refresh));
  const options = cookieOptions(req, 0);
  res.clearCookie("as_access", options);
  res.clearCookie("as_refresh", options);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  void (async () => {
    const token = req.cookies?.as_access as string | undefined;
    if (!token) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      if (payload.kind !== "access" || typeof payload.sub !== "string") {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
        return;
      }
      const user = findUserById(Number(payload.sub));
      if (!user || user.role !== payload.role || user.organizationId !== payload.organizationId) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
        return;
      }
      res.locals.user = user;
      next();
    } catch {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
    }
  })().catch(next);
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to do that" } });
      return;
    }
    next();
  };
}

export async function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function writeAudit(user: AppUser, action: string, entity: string, entityId?: string | number): void {
  db.prepare(`
    INSERT INTO audit_log (organization_id, user_id, action, entity, entity_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.organizationId, user.id, action, entity, entityId == null ? null : String(entityId), new Date().toISOString());
}