import { Router, type IRouter } from "express";
import { db } from "../db";
import { requireAuth, writeAudit } from "../lib/auth";

const router: IRouter = Router();

router.get("/alerts", requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT id, title, severity, acknowledged, created_at
    FROM alerts
    WHERE organization_id = ?
    ORDER BY acknowledged ASC, created_at DESC, id DESC
    LIMIT 200
  `).all(res.locals.user!.organizationId) as Array<{
    id: number;
    title: string;
    severity: "info" | "warning" | "critical";
    acknowledged: number;
    created_at: string;
  }>;
  res.json(rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    severity: row.severity,
    acknowledged: row.acknowledged === 1,
    createdAt: row.created_at,
  })));
});

router.post("/alerts/:id/ack", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const user = res.locals.user!;
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Alert not found." } });
    return;
  }
  const result = db.prepare(`
    UPDATE alerts SET acknowledged = 1
    WHERE id = ? AND organization_id = ?
  `).run(id, user.organizationId);
  if (result.changes === 0) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Alert not found." } });
    return;
  }
  const row = db.prepare(`
    SELECT id, title, severity, acknowledged, created_at
    FROM alerts WHERE id = ? AND organization_id = ?
  `).get(id, user.organizationId) as {
    id: number;
    title: string;
    severity: "info" | "warning" | "critical";
    acknowledged: number;
    created_at: string;
  } | undefined;
  if (!row) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Alert not found." } });
    return;
  }
  writeAudit(user, "acknowledge", "alert", id);
  res.json({
    id: Number(row.id),
    title: row.title,
    severity: row.severity,
    acknowledged: row.acknowledged === 1,
    createdAt: row.created_at,
  });
});

export default router;