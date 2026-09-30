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
const shipmentInputSchema = z.object({
  orderId: z.number().int().positive(),
  truckPlate: z.string().trim().min(3).max(20),
  driverName: z.string().trim().min(2).max(100),
  eta: z.string().datetime(),
});
const shipmentQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(orderStatuses).optional(),
});

router.get("/shipments", requireAuth, (req, res) => {
  const parsed = shipmentQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid shipment filters." } });
    return;
  }
  const user = res.locals.user!;
  const conditions = ["s.organization_id = ?"];
  const args: Array<number | string> = [user.organizationId];
  if (parsed.data.status) {
    conditions.push("o.status = ?");
    args.push(parsed.data.status);
  }
  if (parsed.data.search?.trim()) {
    const term = `%${parsed.data.search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push("(o.code LIKE ? ESCAPE '\\' OR s.truck_plate LIKE ? ESCAPE '\\' OR s.driver_name LIKE ? ESCAPE '\\' OR o.produce LIKE ? ESCAPE '\\')");
    args.push(term, term, term, term);
  }
  const rows = db.prepare(`
    SELECT s.id, s.order_id, o.code AS order_code, s.truck_plate, s.driver_name,
           o.pickup_city, o.dropoff_city, o.status, s.temperature_c, s.eta, s.created_at
    FROM shipments s
    JOIN orders o ON o.id = s.order_id AND o.organization_id = s.organization_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 250
  `).all(...args) as Array<{
    id: number;
    order_id: number;
    order_code: string;
    truck_plate: string;
    driver_name: string;
    pickup_city: string;
    dropoff_city: string;
    status: (typeof orderStatuses)[number];
    temperature_c: number;
    eta: string;
    created_at: string;
  }>;
  res.json(rows.map((row) => ({
    id: Number(row.id),
    orderId: Number(row.order_id),
    orderCode: row.order_code,
    truckPlate: row.truck_plate,
    driverName: row.driver_name,
    pickupCity: row.pickup_city,
    dropoffCity: row.dropoff_city,
    status: row.status,
    temperatureC: Number(row.temperature_c),
    eta: row.eta,
    createdAt: row.created_at,
  })));
});

router.post(
  "/shipments",
  requireAuth,
  requireRole("WAREHOUSE_ADMIN"),
  (req, res) => {
    const parsed = shipmentInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the shipment details." } });
      return;
    }
    const user = res.locals.user!;
    const order = db.prepare(`
      SELECT id, code, status, pickup_city, dropoff_city
      FROM orders WHERE id = ? AND organization_id = ?
    `).get(parsed.data.orderId, user.organizationId) as {
      id: number;
      code: string;
      status: (typeof orderStatuses)[number];
      pickup_city: string;
      dropoff_city: string;
    } | undefined;
    if (!order) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
      return;
    }
    if (order.status !== "Placed" && order.status !== "Confirmed") {
      res.status(409).json({ error: { code: "ORDER_NOT_ASSIGNABLE", message: "Only placed or confirmed orders can be assigned." } });
      return;
    }
    const timestamp = new Date().toISOString();
    const create = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO shipments (organization_id, order_id, truck_plate, driver_name, temperature_c, eta, created_at)
        VALUES (?, ?, ?, ?, 4.0, ?, ?)
      `).run(
        user.organizationId,
        order.id,
        parsed.data.truckPlate.toUpperCase(),
        parsed.data.driverName,
        parsed.data.eta,
        timestamp,
      );
      if (order.status === "Placed") {
        db.prepare("UPDATE orders SET status = 'Confirmed' WHERE id = ? AND organization_id = ?")
          .run(order.id, user.organizationId);
      }
      return Number(result.lastInsertRowid);
    });
    let shipmentId: number;
    try {
      shipmentId = create();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        res.status(409).json({ error: { code: "ORDER_ALREADY_ASSIGNED", message: "This order already has a shipment." } });
        return;
      }
      throw error;
    }
    const shipment = db.prepare(`
      SELECT s.id, s.order_id, o.code AS order_code, s.truck_plate, s.driver_name,
             o.pickup_city, o.dropoff_city, o.status, s.temperature_c, s.eta, s.created_at
      FROM shipments s
      JOIN orders o ON o.id = s.order_id AND o.organization_id = s.organization_id
      WHERE s.id = ? AND s.organization_id = ?
    `).get(shipmentId, user.organizationId) as {
      id: number;
      order_id: number;
      order_code: string;
      truck_plate: string;
      driver_name: string;
      pickup_city: string;
      dropoff_city: string;
      status: (typeof orderStatuses)[number];
      temperature_c: number;
      eta: string;
      created_at: string;
    } | undefined;
    if (!shipment) {
      res.status(500).json({ error: { code: "SHIPMENT_CREATE_FAILED", message: "Could not create the shipment." } });
      return;
    }
    writeAudit(user, "create", "shipment", shipmentId);
    res.status(201).json({
      id: Number(shipment.id),
      orderId: Number(shipment.order_id),
      orderCode: shipment.order_code,
      truckPlate: shipment.truck_plate,
      driverName: shipment.driver_name,
      pickupCity: shipment.pickup_city,
      dropoffCity: shipment.dropoff_city,
      status: shipment.status,
      temperatureC: Number(shipment.temperature_c),
      eta: shipment.eta,
      createdAt: shipment.created_at,
    });
  },
);

export default router;