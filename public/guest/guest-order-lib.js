/** Përbashkët për faqet QR të mysafirit (menu, room-service, shërbime). */
(function (global) {
  const params = new URLSearchParams(global.location.search);
  const room = String(params.get("room") || "").trim();
  const table = String(params.get("table") || params.get("t") || "").trim();

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

  function orderModeLabel() {
    if (room) return `Dhoma ${room}`;
    if (table) return `Tavolina T${table}`;
    return "Takeaway";
  }

  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
      table_number: !room && table ? table : undefined,
      customer_name: extra?.name || "",
      customer_phone: extra?.phone || "",
    };
    if (room) return postJson("/api/guest/menu-order", body);
    return postJson("/api/guest/menu-order", body);
  }

  async function submitServiceCart(cart, extra) {
    if (!room) throw new Error("QR i pavlefshëm — mungon numri i dhomës.");
    const services = cart.entries().map((i) => ({
      service_id: Number(i.id),
      quantity: i.quantity,
      amount: i.price_mode === "variable" ? i.price : undefined,
      notes: extra?.notes || "",
    }));
    return postJson("/api/guest/service-order", {
      room_number: room,
      services,
    });
  }

  global.GuestOrder = {
    room,
    table,
    fmt,
    esc,
    createCart,
    orderModeLabel,
    submitMenuCart,
    submitServiceCart,
    postJson,
  };
})(window);
