// Client-side auth for the static demo. Passwords are salted + SHA-256 hashed,
// login attempts are rate-limited, sessions expire after 30 minutes.
// NOTE: for real production, move this to a server.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let mode = "login";
  const users = () => JSON.parse(localStorage.getItem("as_users") || "{}");
  const password = $("#pw");
  const passwordToggle = $("#togglePassword");
  passwordToggle?.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    passwordToggle.textContent = show ? "Hide" : "Show";
    passwordToggle.setAttribute("aria-pressed", String(show));
    passwordToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
  async function hash(pw, salt) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function startSession(name, role) {
    sessionStorage.setItem("as_session", JSON.stringify({ name, role, exp: Date.now() + 30 * 60 * 1000 }));
    location.href = "dashboard.html";
  }
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    mode = b.dataset.t;
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("#nameF").hidden = $("#roleF").hidden = mode === "login";
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
    $("#sub").textContent = mode === "login" ? "Login" : "Create account";
  }));
  document.querySelectorAll(".demo button").forEach((b) => (b.onclick = () => startSession("Demo " + b.dataset.r, b.dataset.r)));

  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const lock = +localStorage.getItem("as_lock") || 0;
    if (Date.now() < lock) return toast("Too many attempts. Try again in a minute.");
    const em = $("#em"), pw = $("#pw"), nm = $("#nm");
    const email = em.value.trim().toLowerCase();
    const errs = [[em, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email), "Enter a valid email"],
      [pw, mode === "login" ? pw.value.length >= 1 : /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(pw.value), mode === "login" ? "Enter your password" : "Min 8 chars, 1 uppercase, 1 number"]];
    if (mode === "signup") errs.push([nm, nm.value.trim().length >= 2, "Enter your name"]);
    let ok = true;
    errs.forEach(([el, p, m]) => {
      const message = el.closest(".f")?.querySelector(".err") || el.nextElementSibling;
      if (message) message.textContent = p ? "" : m;
      if (!p) ok = false;
    });
    if (!ok) return;
    const db = users();
    if (mode === "signup") {
      if (db[email]) return toast("Account already exists — please log in.");
      const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
      db[email] = { name: nm.value.trim(), role: $("#rl").value, salt, hash: await hash(pw.value, salt) };
      localStorage.setItem("as_users", JSON.stringify(db));
      return startSession(db[email].name, db[email].role);
    }
    const u = db[email];
    if (u && (await hash(pw.value, u.salt)) === u.hash) { localStorage.removeItem("as_fail"); return startSession(u.name, u.role); }
    const fails = (+localStorage.getItem("as_fail") || 0) + 1;
    localStorage.setItem("as_fail", fails);
    if (fails >= 5) { localStorage.setItem("as_lock", Date.now() + 60000); localStorage.removeItem("as_fail"); }
    toast("Invalid email or password");
  };
})();
