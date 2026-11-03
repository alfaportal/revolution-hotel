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
        if (sum && data.summary) sum.textContent = `Totali ${euro(data.summary.total)} · Kamarier ${euro(data.summary.waiter)} · Recepsion ${euro(data.summary.reception)}`;
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
        if (sum) sum.textContent = `Ndryshimi ${euro(data.delta)} (${Number(data.delta_pct) || 0}%)`;
      } else if (pane === "trende") {
        const data = await loadJson("/api/reports/advanced/trends");
        const body = $("adv-trende-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.weeks || [],
            6,
            (data.weeks || [])
              .map(
                (w) => `<tr><td>${esc(w.from)}</td><td>${esc(w.to)}</td><td>${w.order_count}</td><td>${euro(w.total)}</td><td>${euro(w.cash)}</td><td>${euro(w.card)}</td></tr>`,
              )
              .join(""),
          );
        }
      } else if (pane === "qarkullimi") {
        const data = await loadJson(`/api/reports/advanced/turnover${qs({ from: q.from, to: q.to })}`);
        const body = $("adv-qarkullimi-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.categories || [],
            3,
            (data.categories || [])
              .map((c) => `<tr><td>${esc(c.category)}</td><td>${c.qty}</td><td>${euro(c.revenue)}</td></tr>`)
              .join(""),
          );
        }
      } else if (pane === "punonjesit") {
        const data = await loadJson(`/api/reports/advanced/staff${qs({ from: q.from, to: q.to })}`);
        const body = $("adv-punonjesit-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.staff || [],
            6,
            (data.staff || [])
              .map(
                (s) => `<tr><td>${esc(s.operator)}</td><td>${esc(s.station_label)}</td><td>${s.order_count}</td><td>${euro(s.total)}</td><td>${euro(s.cash)}</td><td>${euro(s.card)}</td></tr>`,
              )
              .join(""),
          );
        }
      } else if (pane === "nderrimet") {
        const data = await loadJson(`/api/reports/advanced/shifts${qs({ from: q.from, to: q.to })}`);
        const body = $("adv-nderrimet-body");
        if (body) {
          body.innerHTML = rowsOrEmpty(
            data.shifts || [],
            7,
            (data.shifts || [])
              .map((s) => {
                const open = !!s.is_open;
                return `<tr><td>${esc(s.waiter_name)}</td><td>${esc(s.staff_role === "recepsion" ? "Recepsion" : "Kamarier")}</td><td>${open ? "Hapur" : esc(s.closed_at || "—")}</td><td>${euro(s.total_sales)}</td><td>${open ? "—" : euro(s.closing_cash_actual)}</td><td>${open ? "—" : euro(s.cash_difference)}</td><td>${euro(s.cash_sales_total)}</td></tr>`;
              })
              .join(""),
          );
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
