import assert from "node:assert/strict";

const base = (process.env.API_BASE_URL ?? "http://127.0.0.1:8080/api").replace(/\/+$/, "");
const origin = new URL(base).origin;

function createClient() {
  const cookies = new Map();
  return {
    async request(path, options = {}) {
      const headers = new Headers(options.headers);
      if (!headers.has("origin")) headers.set("Origin", origin);
      if (options.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      if (cookies.size > 0) {
        headers.set(
          "cookie",
          [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
        );
      }
      const response = await fetch(`${base}${path}`, { ...options, headers });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator < 0) continue;
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (/Max-Age=0/i.test(line)) cookies.delete(name);
        else cookies.set(name, value);
      }
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return { response, data };
    },
  };
}

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

const anonymous = createClient();
const health = await anonymous.request("/healthz");
check(health.response.status === 200 && health.data?.status === "ok", "health endpoint responds");
const anonymousUser = await anonymous.request("/auth/me");
check(anonymousUser.response.status === 401, "unauthenticated request is rejected");

const admin = createClient();
const login = await admin.request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "warehouse@agrisupply.pk", password: "AgriDemo2026!" }),
});
check(login.response.status === 200 && login.data?.user?.role === "WAREHOUSE_ADMIN", "warehouse admin can sign in");
const session = await admin.request("/auth/me");
check(session.response.status === 200 && session.data?.organizationId === 1, "session resolves to tenant user");
const page = await admin.request("/orders?page=1&pageSize=20");
check(page.response.status === 200 && page.data?.data?.length === 20 && page.data.total >= 2500, "orders use server-side pagination");
const summary = await admin.request("/dashboard/summary");
check(summary.response.status === 200 && summary.data?.orderCount >= 2500, "dashboard totals come from seeded database rows");

const create = await admin.request("/orders", {
  method: "POST",
  body: JSON.stringify({
    produce: "Mango",
    quantityKg: 750,
    pickupCity: "Multan",
    dropoffCity: "Lahore",
    totalPkr: 185000,
    retailerName: "Smoke Test Market",
  }),
});
check(create.response.status === 201 && create.data?.id > 0, "order creation persists");
const orderId = create.data.id;
const status = await admin.request(`/orders/${orderId}/status`, {
  method: "PATCH",
  body: JSON.stringify({ status: "Confirmed" }),
});
check(status.response.status === 200 && status.data?.status === "Confirmed", "valid order status transition persists");

const shipment = await admin.request("/shipments", {
  method: "POST",
  body: JSON.stringify({
    orderId,
    truckPlate: "LEA-9090",
    driverName: "Smoke Test Driver",
    eta: new Date(Date.now() + 3_600_000).toISOString(),
  }),
});
check(shipment.response.status === 201 && shipment.data?.orderId === orderId, "warehouse admin can assign a shipment");

const alerts = await admin.request("/alerts");
const openAlert = alerts.data?.find((alert) => !alert.acknowledged);
if (openAlert) {
  const ack = await admin.request(`/alerts/${openAlert.id}/ack`, { method: "POST" });
  check(ack.response.status === 200 && ack.data?.acknowledged === true, "alerts can be acknowledged");
} else {
  console.log("SKIP no open alert was available to acknowledge");
}

const crossTenant = createClient();
const secondOrgLogin = await crossTenant.request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "farmer.2@agrisupply.pk", password: "AgriDemo2026!" }),
});
check(secondOrgLogin.response.status === 200, "second tenant can sign in independently");
const privateOrder = await crossTenant.request(`/orders/${orderId}`);
check(privateOrder.response.status === 404, "tenant A order is not visible to tenant B");

const farmer = createClient();
const farmerLogin = await farmer.request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "farmer@agrisupply.pk", password: "AgriDemo2026!" }),
});
check(farmerLogin.response.status === 200, "farmer role can sign in");
const forbiddenAssignment = await farmer.request("/shipments", {
  method: "POST",
  body: JSON.stringify({
    orderId,
    truckPlate: "LEA-0001",
    driverName: "Unauthorized Driver",
    eta: new Date(Date.now() + 3_600_000).toISOString(),
  }),
});
check(forbiddenAssignment.response.status === 403, "role guard blocks unauthorized shipment assignment");

const invalidOrigin = await admin.request("/auth/logout", {
  method: "POST",
  headers: { Origin: "https://attacker.example" },
});
check(invalidOrigin.response.status === 403, "mutating requests reject foreign origins");

const refresh = await admin.request("/auth/refresh", { method: "POST" });
check(refresh.response.status === 200 && refresh.data?.user?.role === "WAREHOUSE_ADMIN", "refresh token rotates and restores the session");
const logout = await admin.request("/auth/logout", { method: "POST" });
check(logout.response.status === 200 && logout.data?.success === true, "logout revokes the refresh session");

console.log("AgriSupply API smoke checks passed.");