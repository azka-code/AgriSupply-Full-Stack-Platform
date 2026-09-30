// Shared: nav, reveal, counters, WhatsApp, scroll-to-top, AI chatbot
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  window.esc = esc;

  const nav = $(".nav");
  const topBtn = document.createElement("button");
  topBtn.className = "fab top"; topBtn.setAttribute("aria-label", "Scroll to top"); topBtn.textContent = "↑";
  topBtn.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  document.body.appendChild(topBtn);
  addEventListener("scroll", () => {
    nav && nav.classList.toggle("scrolled", scrollY > 40);
    topBtn.classList.toggle("show", scrollY > 400);
  }, { passive: true });

  const burger = $(".burger");
  burger && (burger.onclick = () => $(".links").classList.toggle("open"));

  // reveal + counters
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    e.target.querySelectorAll("[data-count]").forEach((el) => {
      const end = +el.dataset.count, suf = el.dataset.suf || ""; let v = 0;
      const t = setInterval(() => { v += end / 60; if (v >= end) { v = end; clearInterval(t); } el.textContent = Math.round(v).toLocaleString() + suf; }, 20);
    });
    io.unobserve(e.target);
  }), { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  document.querySelectorAll(".card").forEach((c) => c.addEventListener("mousemove", (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty("--x", e.clientX - r.left + "px"); c.style.setProperty("--y", e.clientY - r.top + "px");
  }));

  // WhatsApp
  const wa = document.createElement("a");
  const configuredPhone = String(document.body.dataset.whatsappPhone || "").replace(/\D/g, "");
  const waPhone = /^\d{8,15}$/.test(configuredPhone) ? configuredPhone : "";
  const waMessage = encodeURIComponent("Hi AgriSupply, I need help with cold-chain logistics.");
  wa.className = "fab wa";
  wa.href = waPhone ? `https://wa.me/${waPhone}?text=${waMessage}` : `https://wa.me/?text=${waMessage}`;
  wa.target = "_blank";
  wa.rel = "noopener noreferrer";
  wa.setAttribute("aria-label", waPhone ? "Chat with AgriSupply on WhatsApp" : "Open WhatsApp and choose a recipient");
  wa.title = waPhone ? "Chat with AgriSupply on WhatsApp" : "Open WhatsApp with a prepared message";
  wa.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8 8 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.8.4 3.5 3.5 0 0 0-1.1 2.6 6 6 0 0 0 1.3 3.2 13.9 13.9 0 0 0 5.3 4.7c2 .8 2.7.9 3.7.8a3.1 3.1 0 0 0 2-1.4 2.5 2.5 0 0 0 .2-1.4c-.1-.1-.3-.2-.6-.3zM12 21.8a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8zM12 0a12 12 0 0 0-10.3 18L0 24l6.2-1.6A12 12 0 1 0 12 0z"/></svg>';
  const waContact = $(".wa-contact");
  if (waContact) waContact.href = wa.href;
  document.body.appendChild(wa);

  // AI chatbot (on-device intent matching, no data leaves the browser)
  const botBtn = document.createElement("button");
  botBtn.className = "fab bot"; botBtn.setAttribute("aria-label", "Open AI assistant"); botBtn.textContent = "✦";
  const chat = document.createElement("div");
  chat.className = "chat glass";
  chat.innerHTML = `<header><div><b>Agri AI Assistant</b><br><small class="assistant-status">● Online</small></div><button aria-label="Close">×</button></header>
  <div class="msgs"></div>
  <div class="chips"><button>Track shipment</button><button>Heat risk</button><button>Pricing</button><button>Demo login</button></div>
  <form><input maxlength="300" placeholder="Ask anything..." aria-label="Message"><button class="btn btn-pri" aria-label="Send">➤</button></form>`;
  document.body.append(botBtn, chat);
  const msgs = $(".msgs", chat);
  const add = (t, who) => { const d = document.createElement("div"); d.className = "m " + who; d.innerHTML = t; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; };
  const KB = [
    [/track|shipment|truck|where/i, "Live tracking: every truck streams GPS + temperature every 2s. Open <b>Dashboard → Shipments</b> to see ETA and geofence events."],
    [/heat|weather|risk|temp/i, "We pull the weather forecast for pickup & delivery points and compute a <b>Heat Risk</b> badge. Above 38°C we recommend pre-cooling trucks to 4°C."],
    [/price|cost|plan|pkr/i, "Plans: <b>Starter</b> PKR 15,000/mo, <b>Growth</b> PKR 45,000/mo, <b>Enterprise</b> custom. All include IoT alerts & reports."],
    [/login|demo|account|sign/i, "Use the <a href='login.html' class='inline-link'>Login page</a> — quick demo buttons for Farmer, Transporter, Warehouse Admin & Retailer."],
    [/offline|internet|sync/i, "Offline-first: actions are queued on your device and auto-synced when the connection returns."],
    [/mango|kinnow|potato|tomato|onion|spinach|produce/i, "Ideal storage: Kinnow 4–7°C, Mango 10–13°C, Potato 4–8°C, Tomato 10–13°C, Onion 0–4°C, Spinach 0–2°C."],
    [/contact|call|phone|whatsapp/i, "Tap the green WhatsApp button to open a prepared message and choose a recipient, or email <b>hello@agrisupply.pk</b>."],
    [/hi|hello|salam|hey/i, "Wa Alaikum Salam! 👋 How can I help with your cold-chain today?"],
  ];
  const reply = (q) => { const hit = KB.find(([r]) => r.test(q)); return hit ? hit[1] : "Good question! I can help with tracking, heat risk, storage temperatures, pricing and login. Try one of the chips below."; };
  const send = (q) => {
    q = q.trim(); if (!q) return;
    add(esc(q), "u");
    const typing = document.createElement("div"); typing.className = "m b"; typing.textContent = "typing…"; msgs.appendChild(typing);
    setTimeout(() => { typing.remove(); add(reply(q), "b"); }, 650);
  };
  add("Assalam o Alaikum! I'm your AgriSupply AI assistant. Ask me about shipments, temperatures or pricing.", "b");
  botBtn.onclick = () => chat.classList.toggle("open");
  $("header button", chat).onclick = () => chat.classList.remove("open");
  chat.querySelectorAll(".chips button").forEach((b) => (b.onclick = () => send(b.textContent)));
  $("form", chat).onsubmit = (e) => { e.preventDefault(); const i = $("input", chat); send(i.value); i.value = ""; };

  window.toast = (t) => { let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600); };
})();
