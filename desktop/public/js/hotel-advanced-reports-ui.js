(function () {
  let pane = "javore";

  function $(id) {
    return document.getElementById(id);
  }

  function euro(n) {
    const v = Number(n) || 0;
    return (typeof formatEuro === "function" ? formatEuro(v) : `${v.toFixed(2)} €`);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function rowsOrEmpty(list, cols, html) {
    if (!list.length) return `<tr><td colspan="${cols}">Nuk ka të dhëna</td></tr>`;
    return html;
  }

  function setMsg(text, ok) {
    const el = $("adv-reports-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok === false ? "#b91c1c" : "";
  }

  async function loadJson(path) {
    return api(path);
  }

  function query() {
    return {
      date: $("adv-date")?.value || "",
      month: $("adv-month")?.value || "",
      month1: $("adv-month1")?.value || "",
      month2: $("adv-month2")?.value || "",
      from: $("adv-from")?.value || "",
      to: $("adv-to")?.value || "",
    };
  }

  function qs(obj) {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  function shopSummaryText(summary) {
    const shops = summary && summary.shops;
    if (!shops || !shops.restaurant || !shops.reception) {
      return `Totali ${euro(summary?.total)} · Restorant ${euro(summary?.waiter)} · Recepsion ${euro(summary?.reception)}`;
    }
    const r = shops.restaurant;
    const h = shops.reception;
    return `Restorant: cash ${euro(r.cash)} · kartë ${euro(r.card)} · shitur recepsionit ${euro(r.sold_to_reception)} · TOTAL ${euro(r.total)} | Recepsion: cash ${euro(h.cash)} · kartë ${euro(h.card)} · netë ${euro(h.nights)} · shërbime ${euro(h.services)} · walk-in ${euro(h.walkin)} · paguar për restorantin ${euro(h.paid_to_restaurant)} · TOTAL ${euro(h.total)} | TOTALI ${euro(shops.total)}`;
  }

  async function render() {
    const q = query();
    setMsg("");
    try {
      if (pane === "javore") {
        const data = await loadJson(`/api/reports/advanced/weekly${qs({ date: q.date })}`);
        const body = $("adv-javore-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.days || [],
            8,
            (data.days || [])
              .map(
                (d) => `<tr><td>${esc(d.date)}</td><td>${esc(d.day_name)}</td><td>${d.order_count}</td><td>${euro(d.total)}</td><td>${euro(d.cash)}</td><td>${euro(d.card)}</td><td>${euro(d.waiter)}</td><td>${euro(d.reception)}</td></tr>`,
              )
              .join(""),
          );
        }
        const sum = $("adv-javore-sum");
        if (sum && data.summary) sum.textContent = shopSummaryText(data.summary);
      } else if (pane === "mujore") {
        const data = await loadJson(`/api/reports/advanced/monthly${qs({ month: q.month })}`);
        const body = $("adv-mujore-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.days || [],
            7,
            (data.days || [])
              .map(
                (d) => `<tr><td>${esc(d.date)}</td><td>${d.order_count}</td><td>${euro(d.total)}</td><td>${euro(d.cash)}</td><td>${euro(d.card)}</td><td>${euro(d.waiter)}</td><td>${euro(d.reception)}</td></tr>`,
              )
              .join(""),
          );
        }
        const monthSum = $("adv-mujore-sum");
        if (monthSum && data.summary) monthSum.textContent = shopSummaryText(data.summary);
      } else if (pane === "krahasime") {
        const data = await loadJson(`/api/reports/advanced/comparison${qs({ month1: q.month1, month2: q.month2 })}`);
        const body = $("adv-krahasime-body");
        const list = [data.month1, data.month2].filter(Boolean);
        if (body) {
          body.innerHTML = rowsOrEmpty(
            list,
            7,
            list
              .map(
                (m) => `<tr><td>${esc(m.month)}</td><td>${m.summary.order_count}</td><td>${euro(m.summary.total)}</td><td>${euro(m.summary.cash)}</td><td>${euro(m.summary.card)}</td><td>${euro(m.summary.waiter)}</td><td>${euro(m.summary.reception)}</td></tr>`,
              )
              .join(""),
          );
        }
        const sum = $("adv-krahasime-sum");
        if (sum) {
          const a = data.month1?.summary ? shopSummaryText(data.month1.summary) : "";
          const b = data.month2?.summary ? shopSummaryText(data.month2.summary) : "";
          sum.textContent = `${data.month1?.month || ""}: ${a} || ${data.month2?.month || ""}: ${b} || Ndryshimi ${euro(data.delta)} (${Number(data.delta_pct) || 0}%)`;
        }
      } else if (pane === "trende") {
        const data = await loadJson("/api/reports/advanced/trends");
        const body = $("adv-trende-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.weeks || [],
            8,
            (data.weeks || [])
              .map(
                (w) => `<tr><td>${esc(w.from)}</td><td>${esc(w.to)}</td><td>${w.order_count}</td><td>${euro(w.total)}</td><td>${euro(w.cash)}</td><td>${euro(w.card)}</td><td>${euro(w.waiter)}</td><td>${euro(w.reception)}</td></tr>`,
              )
              .join(""),
          );
        }
      } else if (pane === "qarkullimi") {
        const data = await loadJson(`/api/reports/advanced/turnover${qs({ from: q.from, to: q.to })}`);
        const body = $("adv-qarkullimi-body");
        if (body) {
          const lines = data.products || [];
          body.innerHTML = rowsOrEmpty(
            lines,
            5,
            lines
              .map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${p.qty}</td><td>${euro(p.revenue)}</td><td>${p.stock_qty == null ? "—" : p.stock_qty}</td></tr>`)
              .join(""),
          );
        }
        const turnSum = $("adv-qarkullimi-sum");
        if (turnSum) turnSum.textContent = shopSummaryText(data.summary);
      } else if (pane === "punonjesit") {
        const data = await loadJson(`/api/reports/advanced/staff${qs({ from: q.from, to: q.to })}`);
        const body = $("adv-punonjesit-body");
        if (body) {
          const transfer = (data.staff || []).reduce((sum, s) => sum + (Number(s.paid_to_restaurant) || 0), 0);
          const fromEl = $("adv-punonjesit-from");
          if (fromEl) fromEl.textContent = `Shitur recepsionit: ${euro(transfer)} · Paguar për restorantin: ${euro(transfer)}`;
          const people = data.staff || [];
          const restPeople = people.filter((s) => s.shop !== "Recepsion");
          const recPeople = people.filter((s) => s.shop === "Recepsion");
          const personRow = (s) => `<tr><td>${esc(s.operator)}</td><td>${esc(s.shop || s.station_label)}</td><td>${s.order_count}</td><td>${euro(s.cash)}</td><td>${euro(s.card)}</td><td>${euro(s.room)}</td><td>${euro(s.activity_total)}</td><td>${s.shop === "Recepsion" ? `Paguar për restorantin: ${euro(s.paid_to_restaurant)}` : `Shitur recepsionit: ${euro(s.room)}`} · Shërbime të kryera: ${euro(s.services_total)}</td></tr>`;
          body.innerHTML = `<tr><td colspan="8"><strong>Restorant</strong></td></tr>${restPeople.map(personRow).join("") || `<tr><td colspan="8">—</td></tr>`}<tr><td colspan="8"><strong>Recepsion</strong></td></tr>${recPeople.map(personRow).join("") || `<tr><td colspan="8">—</td></tr>`}`;
        }
      } else if (pane === "nderrimet") {
        const data = await loadJson(`/api/reports/advanced/shifts${qs({ from: q.from, to: q.to })}`);
        const body = $("adv-nderrimet-body");
        if (body) {
          const shiftTransfer = (data.shifts || []).reduce((sum, s) => {
            if (s.staff_role === "recepsion") return sum;
            return sum + (Number(s.room_total) || 0);
          }, 0);
          const fromShiftEl = $("adv-nderrimet-from");
          if (fromShiftEl) fromShiftEl.textContent = `Shitur recepsionit: ${euro(shiftTransfer)} · Paguar për restorantin: ${euro(shiftTransfer)}`;
          const shiftRow = (s) => {
            const open = !!s.is_open;
            const cashSales = Number(s.cash_sales_total) || 0;
            const cardSales = Number(s.card_sales_total) || 0;
            const roomSales = Number(s.room_total) || 0;
            const activity = Math.round((cashSales + cardSales + roomSales) * 100) / 100;
            const shop = s.staff_role === "recepsion" ? "Recepsion" : "Restorant";
            return `<tr><td>${esc(s.waiter_name)}</td><td>${esc(shop)}</td><td>${open ? "Hapur" : esc(s.closed_at || "—")}</td><td>${euro(cashSales)}</td><td>${euro(cardSales)}</td><td>${euro(roomSales)}</td><td>${euro(activity)}</td><td>${open ? "—" : euro(s.closing_cash_actual)}</td><td>${open ? "—" : euro(s.cash_difference)}</td></tr>`;
          };
          const restShifts = (data.shifts || []).filter((s) => s.staff_role !== "recepsion");
          const recShifts = (data.shifts || []).filter((s) => s.staff_role === "recepsion");
          body.innerHTML = `<tr><td colspan="9"><strong>Restorant</strong></td></tr>${restShifts.map(shiftRow).join("") || `<tr><td colspan="9">—</td></tr>`}<tr><td colspan="9"><strong>Recepsion</strong></td></tr>${recShifts.map(shiftRow).join("") || `<tr><td colspan="9">—</td></tr>`}`;
        }
      }
    } catch (e) {
      setMsg(e.message || "Gabim", false);
    }
  }

  async function exportCsv() {
    const q = query();
    const map = {
      javore: `/api/reports/advanced/weekly/export/csv${qs({ date: q.date })}`,
      mujore: `/api/reports/advanced/monthly/export/csv${qs({ month: q.month })}`,
      krahasime: `/api/reports/advanced/comparison/export/csv${qs({ month1: q.month1, month2: q.month2 })}`,
      trende: "/api/reports/advanced/trends/export/csv",
      qarkullimi: `/api/reports/advanced/turnover/export/csv${qs({ from: q.from, to: q.to })}`,
      punonjesit: `/api/reports/advanced/staff/export/csv${qs({ from: q.from, to: q.to })}`,
      nderrimet: `/api/reports/advanced/shifts/export/csv${qs({ from: q.from, to: q.to })}`,
    };
    const u = typeof lexoSesionin === "function" ? lexoSesionin() : null;
    const res = await fetch((typeof API === "string" ? API : "") + map[pane], {
      headers: { "X-Session-Token": u?.token || "" },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.gabim || "Eksporti CSV dështoi");
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `raport-${pane}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportPdf() {
    const q = query();
    const map = {
      javore: `/api/reports/advanced/weekly/export/pdf${qs({ date: q.date })}`,
      mujore: `/api/reports/advanced/monthly/export/pdf${qs({ month: q.month })}`,
      krahasime: `/api/reports/advanced/comparison/export/pdf${qs({ month1: q.month1, month2: q.month2 })}`,
      trende: "/api/reports/advanced/trends/export/pdf",
      qarkullimi: `/api/reports/advanced/turnover/export/pdf${qs({ from: q.from, to: q.to })}`,
      punonjesit: `/api/reports/advanced/staff/export/pdf${qs({ from: q.from, to: q.to })}`,
      nderrimet: `/api/reports/advanced/shifts/export/pdf${qs({ from: q.from, to: q.to })}`,
    };
    const data = await api(map[pane]);
    const frame = $("adv-print-frame");
    if (!frame) return;
    frame.srcdoc = data.html || "";
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        setMsg("PDF nuk u hap", false);
      }
    };
  }

  function showPane(name) {
    pane = name;
    document.querySelectorAll(".adv-subtab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.advPane === name);
    });
    document.querySelectorAll(".adv-pane").forEach((el) => {
      el.hidden = el.dataset.advPane !== name;
    });
    render();
  }

  function init() {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    const month = iso.slice(0, 7);
    if ($("adv-date") && !$("adv-date").value) $("adv-date").value = iso;
    if ($("adv-month") && !$("adv-month").value) $("adv-month").value = month;
    if ($("adv-month1") && !$("adv-month1").value) $("adv-month1").value = month;
    if ($("adv-month2") && !$("adv-month2").value) {
      const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      $("adv-month2").value = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    }
    if ($("adv-from") && !$("adv-from").value) $("adv-from").value = iso;
    if ($("adv-to") && !$("adv-to").value) $("adv-to").value = iso;
    document.querySelectorAll(".adv-subtab").forEach((btn) => {
      btn.addEventListener("click", () => showPane(btn.dataset.advPane));
    });
    $("btn-adv-load")?.addEventListener("click", () => render());
    $("btn-adv-csv")?.addEventListener("click", () => exportCsv().catch((e) => setMsg(e.message, false)));
    $("btn-adv-pdf")?.addEventListener("click", () => exportPdf().catch((e) => setMsg(e.message, false)));
    document.querySelectorAll(".adv-pane").forEach((el) => {
      el.hidden = el.dataset.advPane !== "javore";
    });
  }

  window.HotelAdvancedReports = { init, load: render };
  if (document.getElementById("panel-raporte-avancuara")) init();
})();
