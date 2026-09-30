import BetterSqlite3 from "better-sqlite3";
import bcrypt from "bcryptjs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = process.env.AGRISUPPLY_DB_PATH ?? resolve(process.cwd(), "data/agrisupply.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new BetterSqlite3(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('FARMER', 'TRANSPORTER', 'WAREHOUSE_ADMIN', 'RETAILER')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS users_organization_idx ON users(organization_id);
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    produce TEXT NOT NULL,
    quantity_kg REAL NOT NULL,
    pickup_city TEXT NOT NULL,
    dropoff_city TEXT NOT NULL,
    total_pkr REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Placed', 'Confirmed', 'Picked Up', 'In Transit', 'At Warehouse', 'Delivered', 'Rejected')),
    retailer_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS orders_org_code_idx ON orders(organization_id, code);
  CREATE INDEX IF NOT EXISTS orders_org_created_idx ON orders(organization_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS orders_org_status_idx ON orders(organization_id, status);
  CREATE INDEX IF NOT EXISTS orders_org_produce_idx ON orders(organization_id, produce);
  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    truck_plate TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    temperature_c REAL NOT NULL DEFAULT 4.0,
    eta TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shipments_org_idx ON shipments(organization_id);
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    shipment_id INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS alerts_org_ack_idx ON alerts(organization_id, acknowledged, created_at DESC);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    created_at TEXT NOT NULL
  );
`);

const demoPassword = "AgriDemo2026!";
const organizations = [
  { name: "Lahore Fresh Collective", city: "Lahore" },
  { name: "Sahiwal Growers Co-op", city: "Sahiwal" },
  { name: "Multan Citrus Network", city: "Multan" },
  { name: "Kasur Harvest Partners", city: "Kasur" },
];
const demoUsers = [
  { name: "Ayesha Malik", email: "farmer@agrisupply.pk", role: "FARMER" },
  { name: "Bilal Ahmed", email: "transporter@agrisupply.pk", role: "TRANSPORTER" },
  { name: "Hamza Qureshi", email: "warehouse@agrisupply.pk", role: "WAREHOUSE_ADMIN" },
  { name: "Sara Khan", email: "retailer@agrisupply.pk", role: "RETAILER" },
] as const;
const produce = ["Kinnow", "Mango", "Potato", "Tomato", "Onion", "Spinach"];
const pickupCities = ["Okara", "Sahiwal", "Kasur", "Khanewal", "Multan"];
const dropoffCities = ["Lahore", "Faisalabad", "Islamabad", "Rawalpindi"];
const orderStatuses = [
  "Placed",
  "Confirmed",
  "Picked Up",
  "In Transit",
  "At Warehouse",
  "Delivered",
  "Rejected",
] as const;

export function seedDemoData(): void {
  const orgCount = db.prepare("SELECT COUNT(*) AS count FROM organizations").get() as { count: number };
  if (orgCount.count > 0) return;

  const now = new Date();
  const timestamp = now.toISOString();
  const passwordHash = bcrypt.hashSync(demoPassword, 12);
  const addOrganization = db.prepare(
    "INSERT INTO organizations (name, city, created_at) VALUES (?, ?, ?)",
  );
  const addUser = db.prepare(
    "INSERT INTO users (organization_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const addOrder = db.prepare(`
    INSERT INTO orders
      (organization_id, code, produce, quantity_kg, pickup_city, dropoff_city, total_pkr, status, retailer_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const addShipment = db.prepare(`
    INSERT INTO shipments
      (organization_id, order_id, truck_plate, driver_name, temperature_c, eta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const addAlert = db.prepare(`
    INSERT INTO alerts (organization_id, shipment_id, title, severity, acknowledged, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertSeed = db.transaction(() => {
    organizations.forEach((organization, index) => {
      const organizationId = Number(addOrganization.run(organization.name, organization.city, timestamp).lastInsertRowid);
      demoUsers.forEach((user) => {
        const email = index === 0
          ? user.email
          : user.email.replace("@", `.${index + 1}@`);
        addUser.run(organizationId, user.name, email, passwordHash, user.role, timestamp);
      });

      const shipmentIds: number[] = [];
      for (let orderIndex = 0; orderIndex < 2500; orderIndex += 1) {
        const status = orderStatuses[(orderIndex + index) % orderStatuses.length];
        const item = produce[(orderIndex + index) % produce.length];
        const createdAt = new Date(now.getTime() - (orderIndex % 30) * 86_400_000).toISOString();
        const code = `AS-${String(organizationId).padStart(2, "0")}-${String(orderIndex + 1).padStart(5, "0")}`;
        const result = addOrder.run(
          organizationId,
          code,
          item,
          250 + ((orderIndex * 37) % 8000),
          pickupCities[(orderIndex + index) % pickupCities.length],
          dropoffCities[(orderIndex * 3 + index) % dropoffCities.length],
          45_000 + ((orderIndex * 19_731) % 1_200_000),
          status,
          ["Green Basket", "City Mart", "Fresh Fields", "Harvest House"][(orderIndex + index) % 4],
          createdAt,
        );

        if (orderIndex < 32) {
          const orderId = Number(result.lastInsertRowid);
          const shipmentResult = addShipment.run(
            organizationId,
            orderId,
            `LEA-${String(1000 + organizationId * 40 + orderIndex)}`,
            ["Imran Shah", "Naveed Iqbal", "Usman Tariq", "Faisal Raza"][orderIndex % 4],
            2.8 + ((orderIndex * 7) % 42) / 10,
            new Date(now.getTime() + (orderIndex + 1) * 3_600_000).toISOString(),
            createdAt,
          );
          shipmentIds.push(Number(shipmentResult.lastInsertRowid));
        }
      }

      const alerts = [
        ["Temperature approaching upper limit", "warning", 0],
        ["Vehicle delayed near Sheikhupura", "info", 0],
        ["Cold-room door left open", "critical", 1],
        ["Shipment checked in at distribution center", "info", 0],
      ] as const;
      alerts.forEach(([title, severity, acknowledged], alertIndex) => {
        addAlert.run(
          organizationId,
          shipmentIds[alertIndex] ?? null,
          title,
          severity,
          acknowledged,
          new Date(now.getTime() - alertIndex * 45 * 60_000).toISOString(),
        );
      });
    });
  });

  insertSeed();
}

seedDemoData();