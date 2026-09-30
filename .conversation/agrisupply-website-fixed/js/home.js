(function () {
  "use strict";
  // simulated live sensor
  let t = 3.8, eta = 102;
  function setBarLevel(el, percent) {
    const level = Math.round(Math.max(0, Math.min(100, percent)) / 5) * 5;
    [...el.classList].filter((name) => name.startsWith("bar-level-")).forEach((name) => el.classList.remove(name));
    el.classList.add(`bar-level-${level}`);
  }
  setInterval(() => {
    t = Math.min(7, Math.max(2, t + (Math.random() - 0.5) * 0.4));
    eta = Math.max(1, eta - 1);
    document.getElementById("liveTemp").textContent = t.toFixed(1) + "°C";
    setBarLevel(document.getElementById("liveBar"), (t / 8) * 100);
    document.getElementById("liveHum").textContent = 84 + Math.round(Math.random() * 8) + "%";
    document.getElementById("liveEta").textContent = Math.floor(eta / 60) + "h " + (eta % 60) + "m";
  }, 2000);

  // real weather for Lahore (Open-Meteo), cached fallback
  fetch("https://api.open-meteo.com/v1/forecast?latitude=31.55&longitude=74.34&current=temperature_2m")
    .then((r) => r.json())
    .then((d) => { const c = d.current.temperature_2m; localStorage.setItem("wx", c); show(c, false); })
    .catch(() => { const c = localStorage.getItem("wx"); if (c) show(+c, true); });
  function show(c, cached) {
    const lvl = c >= 38 ? "High" : c >= 30 ? "Moderate" : "Low";
    const el = document.getElementById("liveRisk");
    el.textContent = `${lvl} · ${Math.round(c)}°C${cached ? " (cached)" : ""}`;
    el.classList.remove("risk-high", "risk-moderate", "risk-low");
    el.classList.add(`risk-${lvl.toLowerCase()}`);
  }

  // contact form validation
  const f = document.getElementById("contactForm");
  f.onsubmit = (e) => {
    e.preventDefault();
    const [n, em, m] = ["cn", "ce", "cm"].map((id) => document.getElementById(id));
    const rules = [[n, n.value.trim().length >= 2, "Please enter your name"], [em, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value), "Enter a valid email"], [m, m.value.trim().length >= 10, "Message must be at least 10 characters"]];
    let ok = true;
    rules.forEach(([el, pass, msg]) => { el.nextElementSibling.textContent = pass ? "" : msg; if (!pass) ok = false; });
    if (ok) { f.reset(); toast("✓ Message sent! We'll reply within 24 hours."); }
  };
})();
