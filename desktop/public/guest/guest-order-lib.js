/** Përbashkët për faqet QR të mysafirit (menu, room-service, shërbime). */
(function (global) {
  const params = new URLSearchParams(global.location.search);
  const room = String(params.get("room") || "").trim();
  const table = String(params.get("table") || params.get("t") || "").trim();
  const venue = String(params.get("venue") || params.get("spot") || "").trim();

  function apiBase() {
    const path = String(global.location.pathname || "");
    if (path.includes("/hotel/")) return "/hotel";
    return "";
  }

  function guestApi(path) {
    const p = String(path || "").trim();
    const normalized = p.startsWith("/") ? p : `/${p}`;
    return `${apiBase()}${normalized}`;
  }

  function guestSlugFromPath() {
    const path = String(global.location.pathname || "");
    const m = path.match(/\/hotel\/([^/]+)\/guest(?:\/|$)/i);
    if (!m || !m[1]) return "";
    const seg = String(m[1]).trim().toLowerCase();
    if (seg === "guest" || seg === "api") return "";
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      return String(m[1]).trim();
    }
  }

  function guestSlug() {
    return String(
      params.get("slug") || params.get("kitchen_slug") || guestSlugFromPath() || "",
    ).trim();
  }

  function withSlugQuery(apiPath) {
    const url = guestApi(apiPath);
    const slug = guestSlug();
    if (!slug) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}slug=${encodeURIComponent(slug)}`;
  }

  function fmt(n) {
    return Number(n || 0).toFixed(2) + " €";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function createCart() {
    const map = new Map();
    return {
      add(item, qty) {
        const id = String(item.id);
        const prev = map.get(id) || { ...item, quantity: 0 };
        prev.quantity += qty != null ? qty : 1;
        map.set(id, prev);
      },
      setQty(id, qty) {
        const row = map.get(String(id));
        if (!row) return;
        const q = Math.max(0, Math.trunc(Number(qty) || 0));
        if (q <= 0) map.delete(String(id));
        else { row.quantity = q; map.set(String(id), row); }
      },
      entries() { return [...map.values()]; },
      total() {
        let t = 0;
        for (const it of map.values()) t += (Number(it.price) || 0) * (Number(it.quantity) || 0);
        return t;
      },
      count() {
        return [...map.values()].reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      },
      clear() { map.clear(); },
      isEmpty() { return map.size === 0; },
    };
  }

  let venueDisplayLabel = "";
  function orderModeLabel() {
    if (room) return `Dhoma ${room}`;
    if (venueDisplayLabel) return venueDisplayLabel;
    if (table && venue) return `${venue} ${table}`;
    if (table) return `Tavolina ${table}`;
    if (venue) return venue;
    return "Vend i hotelit";
  }

  async function resolveVenueDisplayFromApi() {
    if (room || !guestSlug()) return;
    if (!table && !venue) return;
    try {
      const q = new URLSearchParams();
      if (table) q.set("table", table);
      if (venue) q.set("venue", venue);
      const url = `${withSlugQuery("/api/guest/qr-venue")}&${q.toString()}`;
      const r = await fetch(url);
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.label) venueDisplayLabel = String(d.label).trim();
    } catch {
      /* optional */
    }
  }

  function withSlugBody(body) {
    const slug = guestSlug();
    if (!slug) return body || {};
    const base = body && typeof body === "object" ? { ...body } : {};
    if (!base.slug) base.slug = slug;
    if (!base.kitchen_slug) base.kitchen_slug = slug;
    return base;
  }

  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withSlugBody(body)),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.gabim || d.message || "Gabim");
    return d;
  }

  async function submitMenuCart(cart, extra) {
    const items = cart.entries().map((i) => ({
      id: i.id,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      menu_item_id: i.id,
    }));
    if (!items.length) throw new Error("Shporta është bosh.");
    const body = {
      items,
      room_number: room || undefined,
      table_number: !room && table ? Number(table) || undefined : undefined,
      table: !room && table ? table : undefined,
      venue: !room ? (venue || undefined) : undefined,
      venue_label: !room ? (venueDisplayLabel || venue || undefined) : undefined,
    };
    return postJson(withSlugQuery("/api/guest/menu-order"), body);
  }

  const GUEST_EXPIRED_MSG =
    "Porosia nuk u pranua. Ju lutem porositni përsëri ose thërrisni stafin.";

  function watchOrderUntilAccepted(orderId, onUpdate) {
    const id = String(orderId || "").trim();
    if (!id || typeof onUpdate !== "function") return () => {};
    let stopped = false;
    let timer = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const q = new URLSearchParams({ order_id: id });
        const url = `${withSlugQuery("/api/guest/order-status")}&${q.toString()}`;
        const r = await fetch(url);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        onUpdate(d);
        if (d.status === "expired" || d.status === "cancelled" || d.status === "accepted" || d.status === "ready") {
          stopped = true;
          if (timer) clearInterval(timer);
        }
      } catch {
        /* retry */
      }
    };
    tick();
    timer = setInterval(tick, 8000);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }

  async function submitServiceCart(cart, extra) {
    const services = cart.entries().map((i) => ({
      service_id: Number(i.id),
      quantity: i.quantity,
      amount: i.price_mode === "variable" ? i.price : undefined,
      notes: extra?.notes || "",
      name: i.name,
    }));
    const payload = {
      services,
      customer_name: extra?.name || "",
      venue_label: venueDisplayLabel || venue || undefined,
      table_number: !room && table ? Number(table) || undefined : undefined,
      table: !room && table ? table : undefined,
      venue: !room ? (venue || undefined) : undefined,
    };
    if (room) payload.room_number = room;
    return postJson(withSlugQuery("/api/guest/service-order"), payload);
  }

  global.GuestOrder = {
    room,
    table,
    venue,
    apiBase,
    guestApi,
    guestSlug,
    withSlugQuery,
    fmt,
    esc,
    createCart,
    orderModeLabel,
    resolveVenueDisplayFromApi,
    submitMenuCart,
    submitServiceCart,
    postJson,
    watchOrderUntilAccepted,
    GUEST_EXPIRED_MSG,
  };
})(window);
