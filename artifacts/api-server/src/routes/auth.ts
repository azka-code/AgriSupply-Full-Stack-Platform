import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db";
import {
  clearSession,
  comparePassword,
  findUserById,
  hashPassword,
  publicUser,
  requireAuth,
  rotateSession,
  startSession,
  writeAudit,
  type AppUser,
} from "../lib/auth";

const router: IRouter = Router();
const loginSchema = z.object({
  email: z.string().email().max(255).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
});
const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(255).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  organizationName: z.string().trim().min(2).max(150),
  city: z.string().trim().min(2).max(100),
});

const dummyHash = bcrypt.hashSync("not-a-real-account-password", 12);
const attemptWindows = new Map<string, { startedAt: number; count: number }>();

function limitAuthAttempts(limit: number, windowMs: number): RequestHandler {
  return (req, res, next) => {
    const key = `${req.ip ?? "unknown"}:${req.path}`;
    const now = Date.now();
    const existing = attemptWindows.get(key);
    if (!existing || now - existing.startedAt > windowMs) {
      attemptWindows.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }
    if (existing.count >= limit) {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." } });
      return;
    }
    existing.count += 1;
    next();
  };
}

router.post("/auth/signup", limitAuthAttempts(5, 60 * 60_000), async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the submitted account details." } });
    return;
  }

  const { name, email, password, organizationName, city } = parsed.data;
  const duplicate = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (duplicate) {
    res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "Email already registered" } });
    return;
  }

  const passwordHash = await hashPassword(password);
  const createAccount = db.transaction(() => {
    const organizationResult = db.prepare(
      "INSERT INTO organizations (name, city, created_at) VALUES (?, ?, ?)",
    ).run(organizationName, city, new Date().toISOString());
    const organizationId = Number(organizationResult.lastInsertRowid);
    const userResult = db.prepare(`
      INSERT INTO users (organization_id, name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, 'WAREHOUSE_ADMIN', ?)
    `).run(organizationId, name, email, passwordHash, new Date().toISOString());
    return { userId: Number(userResult.lastInsertRowid), organizationId };
  });
  const created = createAccount();
  const user = findUserById(created.userId);
  if (!user) {
    res.status(500).json({ error: { code: "ACCOUNT_CREATE_FAILED", message: "Could not create the account." } });
    return;
  }
  writeAudit(user, "signup", "user", user.id);
  await startSession(req, res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post("/auth/login", limitAuthAttempts(8, 15 * 60_000), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    return;
  }

  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.password_hash,
           u.organization_id, o.name AS organization_name
    FROM users u
    JOIN organizations o ON o.id = u.organization_id
    WHERE u.email = ? COLLATE NOCASE
  `).get(parsed.data.email) as (AppUser & {
    organization_id: number;
    organization_name: string;
    password_hash: string;
  }) | undefined;

  const passwordValid = await comparePassword(
    parsed.data.password,
    row?.password_hash ?? dummyHash,
  );
  if (!row || !passwordValid) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    return;
  }

  const user = {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    organizationId: Number(row.organization_id),
    organizationName: row.organization_name,
  };
  await startSession(req, res, user);
  writeAudit(user, "login", "user", user.id);
  res.json({ user: publicUser(user) });
});

router.post("/auth/refresh", async (req, res) => {
  const user = await rotateSession(req, res);
  if (!user) {
    clearSession(req, res);
    res.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Your session has expired. Sign in again." } });
    return;
  }
  res.json({ user: publicUser(user) });
});

router.post("/auth/logout", requireAuth, (req, res) => {
  const user = res.locals.user;
  if (user) writeAudit(user, "logout", "user", user.id);
  clearSession(req, res);
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, (_req, res) => {
  res.json(publicUser(res.locals.user!));
});

export default router;