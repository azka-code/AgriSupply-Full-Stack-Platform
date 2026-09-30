import { Router, type IRouter } from "express";
import { db } from "../db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
const statusValues = [
  "Placed",
  "Confirmed",
  "Picked Up",
  "In Transit",
  "At Warehouse",
  "Delivered",
  "Rejected",
] as const;

router.get("/dashboard/summary", requireAuth, (_req, res) => {
  const organizationId = res.locals.user!.organizationId;
  const totals = db.prepare(`
    SELECT COUNT(*) AS order_count, COALESCE(SUM(total_pkr), 0) AS revenue_pkr
    FROM orders WHERE organization_id = ?
  `).get(organizationId) as { order_count: number; revenue_pkr: number };
  const shipmentSummary = db.prepare(`
    SELECT
      COUNT(CASE WHEN o.status NOT IN ('Delivered', 'Rejected') THEN 1 END) AS active_shipments,
      COALESCE(AVG(s.temperature_c), 0) AS average_temperature
    FROM shipments s
    JOIN orders o ON o.id = s.order_id AND o.organization_id = s.organization_id
    WHERE s.organization_id = ?
  `).get(organizationId) as { active_shipments: number; average_temperature: number };
  const alertCount = db.prepare(
    "SELECT COUNT(*) AS count FROM alerts WHERE organization_id = ? AND acknowledged = 0",
  ).get(organizationId) as { count: number };
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS count FROM orders
    WHERE organization_id = ? GROUP BY status
  `).all(organizationId) as Array<{ status: (typeof statusValues)[number]; count: number }>;
  const countsByStatus = new Map(counts.map((item) => [item.status, Number(item.count)]));
  const recentOrders = db.prepare(`
    SELECT id, code, produce, quantity_kg, pickup_city, dropoff_city,
           total_pkr, status, retailer_name, created_at
    FROM orders WHERE organization_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 8
  `).all(organizationId) as Array<{
    id: number;
    code: string;
    produce: string;
    quantity_kg: number;
    pickup_city: string;
    dropoff_city: string;
    total_pkr: number;
    status: (typeof statusValues)[number];
    retailer_name: string;
    created_at: string;
  }>;

  res.json({
    orderCount: Number(totals.order_count),
    activeShipments: Number(shipmentSummary.active_shipments),
    revenuePkr: Number(totals.revenue_pkr),
    averageTemperatureC: Number(shipmentSummary.average_temperature),
    openAlerts: Number(alertCount.count),
    statusCounts: statusValues.map((status) => ({
      status,
      count: countsByStatus.get(status) ?? 0,
    })),
    recentOrders: recentOrders.map((row) => ({
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
    })),
  });
});

export default router;