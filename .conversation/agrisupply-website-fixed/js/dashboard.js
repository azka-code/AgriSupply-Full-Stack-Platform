(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  // --- route guard ---
  const s = JSON.parse(sessionStorage.getItem("as_session") || "null");
  if (!s || s.exp < Date.now()) { sessionStorage.clear(); location.replace("login.html"); return; }
  $("#hello").textContent = "Welcome, " + s.name;
  $("#roleLbl").textContent = s.role + " workspace";
  const tick = () => { const m = Math.max(0, Math.round((s.exp - Date.now()) / 60000)); $("#sess").textContent = "Session " + m + "m"; if (m <= 0) { sessionStorage.clear(); location.replace("login.html"); } };
  tick(); setInterval(tick, 30000);
  $("#logout").onclick = () => { sessionStorage.clear(); location.replace("login.html"); };
  const net = () => { const on = navigator.onLine; $("#net").textContent = on ? "● Online" : "● Offline (cached)"; $("#net").className = "pill " + (on ? "p-ok" : "p-w"); };
  addEventListener("online", net); addEventListener("offline", net); net();
  const sideBtn = $("#sideBtn");
  sideBtn.addEventListener("click", () => {
    const open = $("#side").classList.toggle("open");
    sideBtn.setAttribute("aria-expanded", String(open));
  });

  // --- nav ---
  document.querySelectorAll(".side nav a").forEach((a) => (a.onclick = () => {
    document.querySelectorAll(".side nav a").forEach((x) => x.classList.toggle("on", x === a));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + a.dataset.v));
    $("#side").classList.remove("open");
    sideBtn.setAttribute("aria-expanded", "false");
  }));

  // --- data ---
  const P = ["Kinnow", "Mango", "Potato", "Tomato", "Onion", "Spinach"], C = ["Okara", "Sahiwal", "Kasur"], ST = ["Placed", "Confirmed", "In Transit", "Delivered"];
  const orders = Array.from({ length: 240 }, (_, i) => { const kg = 200 + ((i * 137) % 2800); return { id: "ORD-" + (1000 + i), produce: P[i % 6], kg, from: C[i % 3], total: kg * (60 + (i % 5) * 25), status: ST[(i * 7) % 4] }; });
  const pc = { Placed: "p-i", Confirmed: "p-w", "In Transit": "p-i", Delivered: "p-ok" };

  // --- table (search, sort, paginate, CSV) ---
  let page = 0, sortK = "id", dir = 1, q = "";
  const filtered = () => orders.filter((o) => Object.values(o).join(" ").toLowerCase().includes(q)).sort((a, b) => (a[sortK] > b[sortK] ? dir : -dir));
  function render() {
    const f = filtered(), pages = Math.max(1, Math.ceil(f.length / 10)); page = Math.min(page, pages - 1);
    $("#tb").innerHTML = f.slice(page * 10, page * 10 + 10).map((o) => `<tr><td>${o.id}</td><td>${o.produce}</td><td>${o.kg.toLocaleString()}</td><td>${o.from}</td><td>${o.total.toLocaleString()}</td><td><span class="pill ${pc[o.status]}">${o.status}</span></td></tr>`).join("");
    $("#pg").textContent = `Page ${page + 1} / ${pages}`;
  }
  $("#q").oninput = (e) => { q = e.target.value.toLowerCase().slice(0, 50); page = 0; render(); };
  document.querySelectorAll("th[data-k]").forEach((th) => (th.onclick = () => { dir = sortK === th.dataset.k ? -dir : 1; sortK = th.dataset.k; render(); }));
  $("#prev").onclick = () => { page = Math.max(0, page - 1); render(); };
  $("#next").onclick = () => { page++; render(); };
  $("#csv").onclick = () => {
    const rows = [Object.keys(orders[0]), ...filtered().map((o) => Object.values(o))].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" })); a.download = "orders.csv"; a.click();
  };
  render();

  // --- kanban (drag & drop, persisted) ---
  let kb = JSON.parse(localStorage.getItem("as_kb") || "null") || orders.slice(0, 12).map((o) => ({ id: o.id, t: o.produce + " · " + o.kg + "kg", s: o.status }));
  function renderKb() {
    $("#kb").innerHTML = ST.map((st) => `<div class="glass col" data-s="${st}"><h5>${st} (${kb.filter((k) => k.s === st).length})</h5>${kb.filter((k) => k.s === st).map((k) => `<div class="kc" draggable="true" data-id="${k.id}"><b>${k.id}</b><br><small>${esc(k.t)}</small></div>`).join("")}</div>`).join("");
    document.querySelectorAll(".kc").forEach((c) => (c.ondragstart = (e) => e.dataTransfer.setData("id", c.dataset.id)));
    document.querySelectorAll(".col").forEach((col) => {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
      col.ondragleave = () => col.classList.remove("over");
      col.ondrop = (e) => { const id = e.dataTransfer.getData("id"); const k = kb.find((x) => x.id === id); if (k) { k.s = col.dataset.s; localStorage.setItem("as_kb", JSON.stringify(kb)); toast(`${id} → ${k.s}`); } renderKb(); };
    });
  }
  renderKb();

  // --- sensors ---
  const sensors = ["Cold Room A", "Cold Room B", "Truck LHR-7721", "Truck LHR-4410", "Truck OKR-2201", "Cold Room Thokar"].map((n, i) => ({ n, t: 3 + i * 0.4, max: 8 }));
  const renderSensors = () => {
    $("#sensors").innerHTML = sensors.map((x) => {
      const alert = x.t > x.max;
      const level = Math.round(Math.max(0, Math.min(100, (x.t / 10) * 100)) / 5) * 5;
      return `<div class="glass panel"><h4>${x.n}<span class="pill ${alert ? "p-b" : "p-ok"}">${alert ? "ALERT" : "OK"}</span></h4><div class="temp sensor-temp ${alert ? "sensor-alert" : ""}">${x.t.toFixed(1)}°C</div><div class="bar"><span class="sensor-fill bar-level-${level}"></span></div><small class="muted">Safe band 0–${x.max}°C</small></div>`;
    }).join("");
  };

  // --- users ---
  $("#ub").innerHTML = [["Muhammad Aslam", "Farmer", "Okara Growers"], ["Tariq Mehmood", "Transporter", "Punjab Freight"], ["Ayesha Khan", "Warehouse Admin", "Badami Bagh DC"], ["Bilal Ahmed", "Retailer", "FreshMart"], ["Sana Iqbal", "Farmer", "Sahiwal Agri"]].map(([n, r, o], i) => `<tr><td>${n}</td><td>${r}</td><td>${o}</td><td><span class="pill ${i === 3 ? "p-w" : "p-ok"}">${i === 3 ? "Away" : "Active"}</span></td></tr>`).join("");

  // --- live chart + alerts ---
  const cv = $("#chart"), ctx = cv.getContext("2d"), data = Array.from({ length: 40 }, () => 4 + Math.random());
  const alerts = [["Truck OKR-2201 entered Badami Bagh geofence", ""], ["Heat risk High for Kasur pickup (39°C)", ""]];
  const renderAlerts = () => { $("#alerts").innerHTML = alerts.slice(0, 6).map(([t, c]) => `<li class="${c}">${esc(t)}<br><small class="muted">just now</small></li>`).join(""); };
  function draw() {
    const w = (cv.width = cv.clientWidth * devicePixelRatio), h = (cv.height = 260 * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    const y = (v) => h - (v / 10) * h;
    ctx.strokeStyle = "rgba(255,93,108,.5)"; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, y(8)); ctx.lineTo(w, y(8)); ctx.stroke(); ctx.setLineDash([]);
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(111,211,255,.4)"); g.addColorStop(1, "transparent");
    ctx.beginPath(); data.forEach((v, i) => { const x = (i / (data.length - 1)) * w; i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); });
    ctx.lineWidth = 3 * devicePixelRatio; ctx.strokeStyle = "#6fd3ff"; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fillStyle = g; ctx.fill();
  }
  setInterval(() => {
    const v = Math.max(2, Math.min(9.5, data[data.length - 1] + (Math.random() - 0.48) * 0.9));
    data.push(v); data.shift(); draw();
    $("#k2").textContent = v.toFixed(1) + "°C";
    if (v > 8) { alerts.unshift([`LHR-7721 temp ${v.toFixed(1)}°C above safe band!`, "b"]); renderAlerts(); toast("⚠ Temperature alert: LHR-7721"); data[data.length - 1] = 6; }
    sensors.forEach((x) => (x.t = Math.max(1, Math.min(9, x.t + (Math.random() - 0.5) * 0.5)))); renderSensors();
  }, 2000);
  addEventListener("resize", draw);
  draw(); renderAlerts(); renderSensors();
})();
