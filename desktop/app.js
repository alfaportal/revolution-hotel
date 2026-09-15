/* Përbërës i përbashkët — API dhe ndihmës */

const API = "";
const SESSION_MS = 12 * 60 * 60 * 1000;

let KATEGORITE = [];

async function ngarkoKategorite() {
  const cats = await api("/api/categories");
  KATEGORITE = cats.map(c => c.name);
  return KATEGORITE;
}

async function api(cale, opts = {}) {
  const u = lexoSesionin();
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (u?.token) headers["X-Session-Token"] = u.token;

  const res = await fetch(API + cale, {
    headers,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    dil();
    throw new Error(data.gabim || "Sesioni skadoi");
  }
  if (!res.ok) throw new Error(data.gabim || "Gabim i panjohur");
  return data;
}

function formatEuro(n) {
  return Number(n).toFixed(2) + " €";
}

function ruajSesionin(s) {
  sessionStorage.setItem("rh_user", JSON.stringify(s));
}

function lexoSesionin() {
  try {
    return JSON.parse(sessionStorage.getItem("rh_user") || "null");
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
  sessionStorage.removeItem("rh_user");
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

function sotISO() {
  return new Date().toISOString().slice(0, 10);
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
