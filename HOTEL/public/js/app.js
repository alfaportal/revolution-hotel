/* Përbërës i përbashkët — API dhe ndihmës */

const API = "";
const SESSION_MS = 12 * 60 * 60 * 1000;

let KATEGORITE = [];
let KATEGORITE_FULL = [];

/** @param {{ all?: boolean }} [opts] all=true → përfshin kategoritë e ndaluara (admin). */
async function ngarkoKategorite(opts = {}) {
  const cats = await api("/api/categories");
  KATEGORITE_FULL = Array.isArray(cats) ? cats : [];
  const list = opts.all
    ? KATEGORITE_FULL
    : KATEGORITE_FULL.filter((c) => Number(c.active) !== 0);
  KATEGORITE = list.map((c) => c.name);
  return KATEGORITE;
}

async function api(cale, opts = {}) {
  const u = lexoSesionin();
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (u?.token) headers["X-Session-Token"] = u.token;

  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const res = await fetch(API + cale, {
    headers,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  if (ms >= 100) {
    console.warn(`[slow-http] ${ms}ms ${opts.method || "GET"} ${cale}`);
  }
  if (res.status === 401) {
    const path = String(cale || "");
    const isLoginCall = path.startsWith("/api/login");
    if (u?.token && !isLoginCall) {
      dil();
    }
    throw new Error(data.gabim || (isLoginCall ? "Kredencialet janë të gabuara." : "Sesioni skadoi"));
  }
  if (!res.ok) throw new Error(data.gabim || "Gabim i panjohur");
  return data;
}

function formatEuro(n) {
  return Number(n).toFixed(2) + " €";
}

function menuPhotoUrl(item) {
  if (!item?.id) return "";
  if (item.photo_src) {
    const src = String(item.photo_src);
    if (src.startsWith("/menu-stock/")) return `${src}?v=5`;
    return src;
  }
  if (!item?.has_photo) return "";
  const u = lexoSesionin();
  const q = u?.token ? `?token=${encodeURIComponent(u.token)}` : "";
  return `/api/menu/${item.id}/photo${q}`;
}

function ruajSesionin(s) {
  sessionStorage.setItem("rs_user", JSON.stringify(s));
}

function lexoSesionin() {
  try {
    return JSON.parse(sessionStorage.getItem("rs_user") || "null");
  } catch {
    return null;
  }
}

function dil() {
  const u = lexoSesionin();
  if (u?.token) {
    fetch("/api/logout", {
      method: "POST",
      headers: { "X-Session-Token": u.token },
    }).catch(() => {});
  }
  sessionStorage.removeItem("rs_user");
  window.location.href = "/login.html";
}

function kerkonHyrje(roliKerkuar) {
  const u = lexoSesionin();
  if (!u || u.roli !== roliKerkuar || !u.token) {
    window.location.href = "/login.html";
    return null;
  }
  if (u.login_time) {
    const age = Date.now() - new Date(u.login_time).getTime();
    if (age > SESSION_MS) {
      dil();
      return null;
    }
  }
  return u;
}

function shfaqGabim(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

/** Vendos titullin e dritares nga settings (p.sh. Revolution HOTEL — Hotel Marini). */
function applyAppWindowTitle(settingsOrTitle) {
  let title = "";
  if (typeof settingsOrTitle === "string") title = settingsOrTitle.trim();
  else if (settingsOrTitle && typeof settingsOrTitle === "object") {
    title = String(settingsOrTitle.window_title || settingsOrTitle.app_brand || "").trim();
  }
  if (title) document.title = title;
  return title;
}

function sotISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Badge versioni në UI (login, admin, kamarier). */
function applyAppVersionBadge(settings, elementId) {
  const el = document.getElementById(elementId);
  if (!el || !settings) return;
  const raw = String(settings.app_version || "").trim().replace(/^v/i, "");
  if (!raw) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = `v${raw}`;
  el.hidden = false;
  const brand = String(settings.app_brand || "").trim();
  el.title = brand ? `${brand} — v${raw}` : `Versioni ${raw}`;
}

function mbushSelectKategorive(sel, kategorite) {
  const vlera = sel.value;
  sel.innerHTML = "";
  for (const k of kategorite) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = k;
    sel.appendChild(o);
  }
  if (vlera && kategorite.includes(vlera)) sel.value = vlera;
}

const WAITER_LOCK_MS = 30000;

/** Kyçje e qetë e terminalit të përbashkët (banak / ekrani kryesor) — pas 30 sek pa prekje shkon te login. */
function aktivizoKyçjenTerminaleKamarier() {
  let idleTimer = null;

  function pastro() {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  function kyçTani() {
    pastro();
    dil();
  }

  function rifilloIdle() {
    pastro();
    idleTimer = setTimeout(kyçTani, WAITER_LOCK_MS);
  }

  function onAktivitet() {
    rifilloIdle();
  }

  ["pointerdown", "touchstart", "keydown"].forEach(ev => {
    document.addEventListener(ev, onAktivitet, { passive: true, capture: true });
  });

  window.kyçKamarierPasPorosise = () => rifilloIdle();

  rifilloIdle();
}
