import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole, writeAudit } from "../lib/auth";

const router: IRouter = Router();
const orderStatuses = [
  "Placed",
  "Confirmed",
  "Picked Up",
  "In Transit",
  "At Warehouse",
  "Delivered",
  "Rejected",
] as const;
const orderInputSchema = z.object({
  produce: z.string().trim().min(2).max(60),
  quantityKg: z.number().finite().min(1).max(1_000_000),
  pickupCity: z.string().trim().min(2).max(100),
  dropoffCity: z.string().trim().min(2).max(100),
  totalPkr: z.number().finite().min(1).max(1_000_000_000),
  retailerName: z.string().trim().min(2).max(100),
});
const orderUpdateSchema = orderInputSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "Provide at least one field to update.",
);
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  status: z.enum(orderStatuses).optional(),
});
const statusSchema = z.object({ status: z.enum(orderStatuses) });

interface OrderRow {
  id: number;
  code: string;
  produce: string;
  quantity_kg: number;
  pickup_city: string;
  dropoff_city: string;
  total_pkr: number;
  status: (typeof orderStatuses)[number];
  retailer_name: string;
  created_at: string;
}

function toOrder(row: OrderRow) {
  return {
    id: Number(row.id),
    code: row.code,
    produce: row.produce,
    quantityKg: Number(row.quantity_kg),
    pickupCity: row.pickup_city,
    dropoffCity: row.dropoff_city,
    totalPkr: Number(row.total_pkr),
    status: row.status,
    retailerName: row.retailer_name,
    createdAt: row.created_at,
  };
}

function getOrderForOrg(id: number, organizationId: number): OrderRow | undefined {
  return db.prepare(`
    SELECT id, code, produce, quantity_kg, pickup_city, dropoff_city,
           total_pkr, status, retailer_name, created_at
    FROM orders
    WHERE id = ? AND organization_id = ?
  `).get(id, organizationId) as OrderRow | undefined;
}

router.get("/orders", requireAuth, (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order filters." } });
    return;
  }
  const user = res.locals.user!;
  const { page, pageSize, search, status } = parsed.data;
  const clauses = ["organization_id = ?"];
  const args: Array<string | number> = [user.organizationId];
  if (status) {
    clauses.push("status = ?");
    args.push(status);
  }
  if (search?.trim()) {
    const term = `%${search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    clauses.push("(code LIKE ? ESCAPE '\\' OR produce LIKE ? ESCAPE '\\' OR retailer_name LIKE ? ESCAPE '\\' OR pickup_city LIKE ? ESCAPE '\\' OR dropoff_city LIKE ? ESCAPE '\\')");
    args.push(term, term, term, term, term);
  }
  const where = clauses.join(" AND ");
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM orders WHERE ${where}`).get(...args) as { total: number };
  const data = db.prepare(`
    SELECT id, code, produce, quantity_kg, pickup_city, dropoff_city,
           total_pkr, status, retailer_name, created_at
    FROM orders
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, (page - 1) * pageSize) as OrderRow[];
  res.json({ data: data.map(toOrder), total: Number(totalRow.total), page, pageSize });
});

router.post(
  "/orders",
  requireAuth,
  requireRole("FARMER", "RETAILER", "WAREHOUSE_ADMIN"),
  (req, res) => {
    const parsed = orderInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the order details." } });
      return;
    }
    const user = res.locals.user!;
    const input = parsed.data;
    const code = `AS-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO orders
        (organization_id, code, produce, quantity_kg, pickup_city, dropoff_city, total_pkr, status, retailer_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Placed', ?, ?)
    `).run(
      user.organizationId,
      code,
      input.produce,
      input.quantityKg,
      input.pickupCity,
      input.dropoffCity,
      input.totalPkr,
      input.retailerName,
      createdAt,
    );
    const order = getOrderForOrg(Number(result.lastInsertRowid), user.organizationId);
    if (!order) {
      res.status(500).json({ error: { code: "ORDER_CREATE_FAILED", message: "Could not create the order." } });
      return;
    }
    writeAudit(user, "create", "order", order.id);
    res.status(201).json(toOrder(order));
  },
);

router.get("/orders/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const user = res.locals.user!;
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
    return;
  }
  const order = getOrderForOrg(id, user.organizationId);
  if (!order) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
    return;
  }
  res.json(toOrder(order));
});

router.patch("/orders/:id", requireAuth, (req, res) => {
  const user = res.locals.user!;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
    return;
  }
  const parsed = orderUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the order details." } });
    return;
  }
  const existing = getOrderForOrg(id, user.organizationId);
  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
    return;
  }
  if (user.role !== "WAREHOUSE_ADMIN" && !(["FARMER", "RETAILER"].includes(user.role) && existing.status === "Placed")) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "This order can no longer be edited." } });
    return;
  }

  const columns: Record<keyof typeof parsed.data, string> = {
    produce: "produce",
    quantityKg: "quantity_kg",
    pickupCity: "pickup_city",
    dropoffCity: "dropoff_city",
    totalPkr: "total_pkr",
    retailerName: "retailer_name",
  };
  const entries = Object.entries(parsed.data) as Array<[keyof typeof parsed.data, string | number]>;
  const assignments = entries.map(([field]) => `${columns[field]} = ?`);
  const values = entries.map(([, value]) => value);
  db.prepare(`UPDATE orders SET ${assignments.join(", ")} WHERE id = ? AND organization_id = ?`)
    .run(...values, id, user.organizationId);
  const updated = getOrderForOrg(id, user.organizationId);
  if (!updated) {
    res.status(500).json({ error: { code: "ORDER_UPDATE_FAILED", message: "Could not update the order." } });
    return;
  }
  writeAudit(user, "update", "order", id);
  res.json(toOrder(updated));
});

router.delete("/orders/:id", requireAuth, (req, res) => {
  const user = res.locals.user!;
  const id = Number(req.params.id);
  const existing = Number.isSafeInteger(id) && id > 0 ? getOrderForOrg(id, user.organizationId) : undefined;
  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
    return;
  }
  if (user.role !== "WAREHOUSE_ADMIN" && !(["FARMER", "RETAILER"].includes(user.role) && existing.status === "Placed")) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "This order can no longer be deleted." } });
    return;
  }
  db.prepare("DELETE FROM orders WHERE id = ? AND organization_id = ?").run(id, user.organizationId);
  writeAudit(user, "delete", "order", id);
  res.json({ success: true });
});

const allowedTransitions: Record<(typeof orderStatuses)[number], readonly (typeof orderStatuses)[number][]> = {
  Placed: ["Confirmed", "Rejected"],
  Confirmed: ["Picked Up", "Rejected"],
  "Picked Up": ["In Transit"],
  "In Transit": ["At Warehouse"],
  "At Warehouse": ["Delivered", "Rejected"],
  Delivered: [],
  Rejected: [],
};

router.patch("/orders/:id/status", requireAuth, (req, res) => {
  const user = res.locals.user!;
  const id = Number(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order status update." } });
    return;
  }
  const existing = getOrderForOrg(id, user.organizationId);
  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
    return;
  }
  const isAdmin = user.role === "WAREHOUSE_ADMIN";
  const isTransporterMove = user.role === "TRANSPORTER" &&
    ((existing.status === "Picked Up" && parsed.data.status === "In Transit") ||
      (existing.status === "In Transit" && parsed.data.status === "At Warehouse"));
  if (!allowedTransitions[existing.status].includes(parsed.data.status) || (!isAdmin && !isTransporterMove)) {
    res.status(409).json({ error: { code: "TRANSITION_NOT_ALLOWED", message: "That status change is not allowed for your role." } });
    return;
  }
  db.prepare("UPDATE orders SET status = ? WHERE id = ? AND organization_id = ?")
    .run(parsed.data.status, id, user.organizationId);
  const updated = getOrderForOrg(id, user.organizationId);
  if (!updated) {
    res.status(500).json({ error: { code: "ORDER_UPDATE_FAILED", message: "Could not update the order." } });
    return;
  }
  writeAudit(user, "status_change", "order", id);
  res.json(toOrder(updated));
});

export default router;