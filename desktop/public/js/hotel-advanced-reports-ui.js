(function () {
  const chartInstances = {};
  let activePane = "javore";

  function $(id) {
    return document.getElementById(id);
  }

  function euro(n) {
    const v = Number(n) || 0;
    return typeof formatEuro === "function" ? formatEuro(v) : `${v.toFixed(2)} €`;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtQty(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  function pct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(1)}%`;
  }

  function trendClass(v) {
    const n = Number(v) || 0;
    if (n > 0) return "adv-trend-up";
    if (n < 0) return "adv-trend-down";
    return "";
  }

  function trendArrow(v) {
    const n = Number(v) || 0;
    if (n > 0) return "▲";
    if (n < 0) return "▼";
    return "•";
  }

  function pctChange(fromVal, toVal) {
    const a = Number(fromVal) || 0;
    const b = Number(toVal) || 0;
    if (!a) return b ? 100 : 0;
    return Math.round(((b - a) / a) * 1000) / 10;
  }

  function setMsg(text, ok) {
    const el = $("adv-reports-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok === false ? "#dc2626" : "var(--ngjyr-success, #059669)";
  }

  function renderKpiRow(containerId, cards) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = cards
      .map(
        (c) => `<div class="dashboard-kpi"><div class="dashboard-kpi-label">${esc(c.label)}</div>
          <div class="dashboard-kpi-val">${c.value}</div></div>`,
      )
      .join("");
  }

  function advPalette() {
    return { primary: "#FF6B35", primarySoft: "rgba(255,107,53,0.75)", text: "#e8e8ef", grid: "rgba(255,255,255,0.08)" };
  }

  function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }
  }

  function barScales() {
    const p = advPalette();
    return {
      x: { ticks: { color: p.text }, grid: { color: p.grid } },
      y: { ticks: { color: p.text }, grid: { color: p.grid }, beginAtZero: true },
    };
  }

  function createChart(canvasId, config) {
    destroyChart(canvasId);
    const canvas = $(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    chartInstances[canvasId] = new Chart(canvas, config);
    return chartInstances[canvasId];
  }

  function barChart(canvasId, labels, data, label) {
    const p = advPalette();
    createChart(canvasId, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: p.primarySoft,
          borderColor: p.primary,
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: p.text } } },
        scales: barScales(),
      },
    });
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function monthRange(ym, monthsBack) {
    const [y, m] = String(ym || "").slice(0, 7).split("-").map(Number);
    const end = new Date(y, m, 0);
    const start = new Date(y, m - 1, 1);
    start.setMonth(start.getMonth() - (Number(monthsBack) || 0));
    return { from: isoDate(start), to: isoDate(end) };
  }

  function periodRange(period, monthYm, fromId, toId) {
    const today = new Date();
    const todayIso = isoDate(today);
    if (period === "custom") {
      return {
        from: $(fromId)?.value || `${todayIso.slice(0, 7)}-01`,
        to: $(toId)?.value || todayIso,
      };
    }
    if (period === "sot") return { from: todayIso, to: todayIso };
    if (period === "java") {
      const start = new Date(today);
      start.setDate(today.getDate() - 6);
      return { from: isoDate(start), to: todayIso };
    }
    const back = period === "3months" ? 2 : period === "6months" ? 5 : period === "12months" ? 11 : 0;
    return monthRange(monthYm || todayIso.slice(0, 7), back);
  }

  function shopKpis(summary) {
    const s = summary || {};
    return [
      { label: "Shitjet totale", value: euro(s.total) },
      { label: "Cash", value: euro(s.cash) },
      { label: "Kartë", value: euro(s.card) },
      { label: "Restorant", value: euro(s.waiter) },
      { label: "Recepsion", value: euro(s.reception) },
      { label: "Nr. porosive", value: String(s.order_count ?? 0) },
    ];
  }

  function moneyCell(n) {
    return `<td style="text-align:right">${euro(n)}</td>`;
  }

  async function loadWeekly() {
    const date = $("adv-week-date")?.value || isoDate(new Date());
    setMsg("Duke ngarkuar…", true);
    const r = await api(`/api/reports/advanced/weekly?date=${encodeURIComponent(date)}`);
    renderKpiRow("adv-week-kpi", shopKpis(r.summary));
    const body = $("adv-week-body");
    const days = r.days || [];
    if (body) {
      const rows = days
        .map(
          (d) => `<tr><td>${esc(d.day_name)}</td><td>${esc(d.date)}</td><td>${d.order_count || 0}</td>${moneyCell(d.total)}${moneyCell(d.cash)}${moneyCell(d.card)}${moneyCell(d.waiter)}${moneyCell(d.reception)}</tr>`,
        )
        .join("");
      const s = r.summary || {};
      body.innerHTML =
        rows +
        `<tr class="adv-total-row"><td colspan="2"><strong>Totali</strong></td><td><strong>${s.order_count || 0}</strong></td>${moneyCell(s.total)}${moneyCell(s.cash)}${moneyCell(s.card)}${moneyCell(s.waiter)}${moneyCell(s.reception)}</tr>`;
    }
    barChart(
      "chart-weekly-sales",
      days.map((d) => d.day_name || d.date),
      days.map((d) => Number(d.total) || 0),
      "Shitjet (€)",
    );
    setMsg(`${r.from || ""} — ${r.to || ""}`, true);
  }

  function weeksFromDays(days) {
    const map = new Map();
    for (const d of days || []) {
      const dt = new Date(`${d.date}T12:00:00`);
      const n = Math.floor((dt.getDate() - 1) / 7) + 1;
      const cur = map.get(n) || { week_num: n, order_count: 0, total: 0, cash: 0, card: 0, waiter: 0, reception: 0 };
      cur.order_count += Number(d.order_count) || 0;
      cur.total += Number(d.total) || 0;
      cur.cash += Number(d.cash) || 0;
      cur.card += Number(d.card) || 0;
      cur.waiter += Number(d.waiter) || 0;
      cur.reception += Number(d.reception) || 0;
      map.set(n, cur);
    }
    return [...map.values()];
  }

  async function loadMonthly() {
    const month = ($("adv-month-picker")?.value || isoDate(new Date()).slice(0, 7)).slice(0, 7);
    setMsg("Duke ngarkuar…", true);
    const r = await api(`/api/reports/advanced/monthly?month=${encodeURIComponent(month)}`);
    renderKpiRow("adv-month-kpi", shopKpis(r.summary));
    const weeks = weeksFromDays(r.days);
    const body = $("adv-month-weeks-body");
    if (body) {
      const rows = weeks
        .map(
          (w) => `<tr><td>Java ${w.week_num}</td><td>${w.order_count}</td>${moneyCell(w.total)}${moneyCell(w.cash)}${moneyCell(w.card)}${moneyCell(w.waiter)}${moneyCell(w.reception)}</tr>`,
        )
        .join("");
      const s = r.summary || {};
      body.innerHTML =
        rows +
        `<tr class="adv-total-row"><td><strong>Totali</strong></td><td><strong>${s.order_count || 0}</strong></td>${moneyCell(s.total)}${moneyCell(s.cash)}${moneyCell(s.card)}${moneyCell(s.waiter)}${moneyCell(s.reception)}</tr>`;
    }
    const range = monthRange(month, 0);
    let categories = [];
    try {
      const turn = await api(`/api/reports/advanced/turnover?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      categories = turn.categories || [];
    } catch {
      categories = [];
    }
    const catBody = $("adv-month-cat-body");
    if (catBody) {
      catBody.innerHTML = categories.length
        ? categories
            .map((c) => `<tr><td>${esc(c.category)}</td><td style="text-align:right">${fmtQty(c.qty)}</td>${moneyCell(c.revenue)}</tr>`)
            .join("")
        : `<tr><td colspan="3">S’ka kategori / shitje.</td></tr>`;
    }
    barChart(
      "chart-month-weeks",
      weeks.map((w) => `Java ${w.week_num}`),
      weeks.map((w) => w.total),
      "Shitjet (€)",
    );
    barChart(
      "chart-month-categories",
      categories.map((c) => c.category),
      categories.map((c) => Number(c.revenue) || 0),
      "Kategori (€)",
    );
    setMsg(`Muaji ${r.month || month}`, true);
  }

  async function topProducts(ym) {
    const range = monthRange(ym, 0);
    try {
      const turn = await api(`/api/reports/advanced/turnover?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      return (turn.products || []).slice(0, 5);
    } catch {
      return [];
    }
  }

  async function loadComparison() {
    const m1 = ($("adv-cmp-m1")?.value || "").slice(0, 7);
    const m2 = ($("adv-cmp-m2")?.value || "").slice(0, 7);
    if (!m1 || !m2) {
      setMsg("Zgjidhni të dy muajt.", false);
      return;
    }
    setMsg("Duke ngarkuar…", true);
    const r = await api(`/api/reports/advanced/comparison?month1=${encodeURIComponent(m1)}&month2=${encodeURIComponent(m2)}`);
    const a = r.month1?.summary || {};
    const b = r.month2?.summary || {};
    const rows = [
      ["Shitjet totale", a.total, b.total, true],
      ["Cash", a.cash, b.cash, true],
      ["Kartë", a.card, b.card, true],
      ["Restorant", a.waiter, b.waiter, true],
      ["Recepsion", a.reception, b.reception, true],
      ["Nr. porosive", a.order_count, b.order_count, false],
    ];
    const tbody = $("adv-cmp-metrics-body");
    if (tbody) {
      tbody.innerHTML = rows
        .map(([label, v1, v2, isMoney]) => {
          const ch = pctChange(v1, v2);
          return `<tr><td>${label}</td><td style="text-align:right">${isMoney ? euro(v1) : v1 || 0}</td><td style="text-align:right">${isMoney ? euro(v2) : v2 || 0}</td><td class="${trendClass(ch)}" style="text-align:right">${trendArrow(ch)} ${pct(ch)}</td></tr>`;
        })
        .join("");
    }
    const [p1, p2] = await Promise.all([topProducts(m1), topProducts(m2)]);
    const prodWrap = $("adv-cmp-products");
    if (prodWrap) {
      const list = (arr) =>
        arr.map((p, i) => `<li>${i + 1}. ${esc(p.name)} — ${euro(p.revenue)}</li>`).join("") || "<li>—</li>";
      prodWrap.innerHTML = `<div><strong>${esc(m1)}</strong><ul>${list(p1)}</ul></div><div><strong>${esc(m2)}</strong><ul>${list(p2)}</ul></div>`;
    }
    setMsg(`Krahasim ${m1} vs ${m2}`, true);
  }

  function decorateTurnover(products, from, to) {
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    let rateSum = 0;
    let risk = 0;
    let dead = 0;
    const rows = (products || []).map((p) => {
      const qty = Number(p.qty) || 0;
      const stock = p.stock_qty == null ? null : Number(p.stock_qty) || 0;
      const rate = stock > 0 ? qty / stock : qty > 0 ? qty : 0;
      const daily = qty / days;
      const daysStock = qty > 0 && stock != null ? stock / daily : null;
      rateSum += rate;
      if (qty > 0 && daysStock != null && daysStock < 7) risk += 1;
      if (rate === 0 && stock > 0) dead += 1;
      return { ...p, turnover_rate: rate, days_of_stock: daysStock };
    });
    return {
      rows,
      average: rows.length ? rateSum / rows.length : 0,
      risk,
      dead,
    };
  }

  async function loadTurnover() {
    const period = $("adv-turnover-period")?.value || "month";
    const month = ($("adv-turnover-month")?.value || isoDate(new Date()).slice(0, 7)).slice(0, 7);
    const range = periodRange(period, month);
    setMsg("Duke ngarkuar…", true);
    const r = await api(`/api/reports/advanced/turnover?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
    const packed = decorateTurnover(r.products, range.from, range.to);
    renderKpiRow("adv-turnover-kpi", [
      { label: "Qarkullimi mesatar", value: fmtQty(packed.average) },
      { label: "Produkte në rrezik", value: String(packed.risk) },
      { label: "Stok i vdekur", value: String(packed.dead) },
    ]);
    const tbody = $("adv-turnover-body");
    if (tbody) {
      tbody.innerHTML = packed.rows.length
        ? packed.rows
            .map((row) => {
              const qty = Number(row.qty) || 0;
              const stock = Number(row.stock_qty) || 0;
              const rate = Number(row.turnover_rate) || 0;
              let cls = "";
              if (qty > 0 && row.days_of_stock != null && row.days_of_stock < 7) cls = "adv-stockout-risk";
              else if (rate === 0 && stock > 0) cls = "adv-dead-stock";
              const daysCell = qty <= 0 ? "∞" : row.days_of_stock == null ? "—" : fmtQty(row.days_of_stock);
              return `<tr class="${cls}"><td>${esc(row.name)}</td><td>${esc(row.category || "—")}</td><td style="text-align:right">${fmtQty(row.qty)}</td><td style="text-align:right">${row.stock_qty == null ? "—" : fmtQty(row.stock_qty)}</td><td style="text-align:right">${fmtQty(row.turnover_rate)}</td><td style="text-align:right">${daysCell}</td></tr>`;
            })
            .join("")
        : `<tr><td colspan="6">S’ka produkte.</td></tr>`;
    }
    const top = packed.rows.slice(0, 12);
    barChart(
      "chart-turnover-top",
      top.map((p) => p.name),
      top.map((p) => Number(p.qty) || 0),
      "Sasia e shitur",
    );
    setMsg(`${range.from} — ${range.to}`, true);
  }

  function syncCustom(periodId, wrapId, monthId) {
    const p = $(periodId)?.value || "month";
    const wrap = $(wrapId);
    const monthIn = $(monthId);
    if (wrap) wrap.hidden = p !== "custom";
    if (monthIn) monthIn.hidden = p === "custom" || p === "sot" || p === "java";
  }

  async function loadEmployees() {
    const period = $("adv-emp-period")?.value || "month";
    const month = ($("adv-emp-month")?.value || isoDate(new Date()).slice(0, 7)).slice(0, 7);
    const range = periodRange(period, month, "adv-emp-from", "adv-emp-to");
    setMsg("Duke ngarkuar…", true);
    const r = await api(`/api/reports/advanced/staff?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
    const people = r.staff || [];
    const top = people[0];
    const cash = people.reduce((s, e) => s + (Number(e.cash) || 0), 0);
    const card = people.reduce((s, e) => s + (Number(e.card) || 0), 0);
    renderKpiRow("adv-emp-kpi", [
      { label: "Punonjësi më i mirë", value: top ? `${top.operator} (${euro(top.total)})` : "—" },
      { label: "Cash", value: euro(cash) },
      { label: "Kartë", value: euro(card) },
      { label: "Restorant", value: euro(people.filter((e) => e.shop !== "Recepsion").reduce((s, e) => s + (Number(e.total) || 0), 0)) },
      { label: "Recepsion", value: euro(people.filter((e) => e.shop === "Recepsion").reduce((s, e) => s + (Number(e.total) || 0), 0)) },
    ]);
    const tbody = $("adv-emp-body");
    if (tbody) {
      const row = (e, cls) => `<tr class="${cls}"><td>${esc(e.operator)}</td><td>${esc(e.shop || e.station_label)}</td><td>${e.order_count || 0}</td>${moneyCell(e.total)}${moneyCell(e.cash)}${moneyCell(e.card)}${moneyCell(e.room || e.paid_to_restaurant)}</tr>`;
      const rest = people.filter((e) => e.shop !== "Recepsion");
      const rec = people.filter((e) => e.shop === "Recepsion");
      tbody.innerHTML = people.length
        ? `<tr><td colspan="7"><strong>Restorant</strong></td></tr>${rest.map((e, i) => row(e, i === 0 ? "adv-top-performer" : "")).join("") || `<tr><td colspan="7">—</td></tr>`}<tr><td colspan="7"><strong>Recepsion</strong></td></tr>${rec.map((e) => row(e, "")).join("") || `<tr><td colspan="7">—</td></tr>`}`
        : `<tr><td colspan="7">S’ka shitje për këtë periudhë.</td></tr>`;
    }
    barChart(
      "chart-employees-revenue",
      people.slice(0, 12).map((e) => e.operator),
      people.slice(0, 12).map((e) => Number(e.total) || 0),
      "Të ardhurat (€)",
    );
    setMsg(`${range.from} — ${range.to}`, true);
  }

  async function loadTrends() {
    setMsg("Duke ngarkuar…", true);
    const r = await api("/api/reports/advanced/trends");
    const weeks = r.weeks || [];
    const first = Number(weeks[0]?.total) || 0;
    const last = Number(weeks[weeks.length - 1]?.total) || 0;
    const dir = last > first ? "Rritje" : last < first ? "Rënie" : "Stabil";
    const summary = $("adv-trend-summary");
    if (summary) {
      summary.innerHTML = `<div class="dashboard-kpi ${last > first ? "adv-trend-up" : last < first ? "adv-trend-down" : ""}"><div class="dashboard-kpi-label">Trendi i përgjithshëm</div><div class="dashboard-kpi-val">${dir}</div></div>`;
    }
    const body = $("adv-trend-body");
    if (body) {
      body.innerHTML = weeks
        .map((w, i) => {
          const prev = i ? Number(weeks[i - 1].total) || 0 : Number(w.total) || 0;
          const ch = pctChange(prev, w.total);
          return `<tr><td>${esc(w.from)}</td><td>${esc(w.to)}</td>${moneyCell(w.total)}${moneyCell(w.cash)}${moneyCell(w.card)}<td>${w.order_count || 0}</td>${moneyCell(w.waiter)}${moneyCell(w.reception)}<td class="${trendClass(ch)}" style="text-align:right">${trendArrow(ch)} ${pct(ch)}</td></tr>`;
        })
        .join("") || `<tr><td colspan="9">S’ka të dhëna.</td></tr>`;
    }
    barChart(
      "chart-trends-revenue",
      weeks.map((w) => w.from),
      weeks.map((w) => Number(w.total) || 0),
      "Shitjet (€)",
    );
    setMsg("", true);
  }

  async function loadShifts() {
    const period = $("adv-shift-period")?.value || "month";
    const month = ($("adv-shift-month")?.value || isoDate(new Date()).slice(0, 7)).slice(0, 7);
    const range = periodRange(period, month, "adv-shift-from", "adv-shift-to");
    setMsg("Duke ngarkuar…", true);
    const r = await api(`/api/reports/advanced/shifts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
    const body = $("adv-shift-body");
    const rows = r.shifts || [];
    if (body) {
      const line = (s) => {
        const open = !!s.is_open;
        const shop = s.staff_role === "recepsion" ? "Recepsion" : "Restorant";
        const room = Number(s.room_total) || 0;
        const total = (Number(s.cash_sales_total) || 0) + (Number(s.card_sales_total) || 0) + room;
        return `<tr><td>${esc(s.waiter_name)}</td><td>${esc(shop)}</td><td>${open ? "Hapur" : "Mbyllur"}</td><td>${open ? "Hapur" : esc(s.closed_at || "—")}</td>${moneyCell(s.cash_sales_total)}${moneyCell(s.card_sales_total)}${moneyCell(room)}${moneyCell(total)}<td style="text-align:right">${open ? "—" : euro(s.closing_cash_actual)}</td><td style="text-align:right">${open ? "—" : euro(s.cash_difference)}</td></tr>`;
      };
      const rest = rows.filter((s) => s.staff_role !== "recepsion");
      const rec = rows.filter((s) => s.staff_role === "recepsion");
      body.innerHTML = rows.length
        ? `<tr><td colspan="10"><strong>Restorant</strong></td></tr>${rest.map(line).join("") || `<tr><td colspan="10">—</td></tr>`}<tr><td colspan="10"><strong>Recepsion</strong></td></tr>${rec.map(line).join("") || `<tr><td colspan="10">—</td></tr>`}`
        : `<tr><td colspan="10" class="purchases-empty">Nuk ka ndërrime për këtë periudhë</td></tr>`;
    }
    setMsg(`${range.from} — ${range.to}`, true);
  }

  const loaders = {
    javore: loadWeekly,
    mujore: loadMonthly,
    krahasime: loadComparison,
    trende: loadTrends,
    qarkullimi: loadTurnover,
    punonjesit: loadEmployees,
    nderrimet: loadShifts,
  };

  const exportKind = {
    weekly: "javore",
    monthly: "mujore",
    comparison: "krahasime",
    trends: "trende",
    turnover: "qarkullimi",
    employees: "punonjesit",
    shifts: "nderrimet",
  };

  function exportQuery(kind) {
    const pane = exportKind[kind] || activePane;
    const today = isoDate(new Date());
    const ym = today.slice(0, 7);
    if (pane === "javore") return `date=${encodeURIComponent($("adv-week-date")?.value || today)}`;
    if (pane === "mujore") return `month=${encodeURIComponent(($("adv-month-picker")?.value || ym).slice(0, 7))}`;
    if (pane === "krahasime") {
      return `month1=${encodeURIComponent(($("adv-cmp-m1")?.value || "").slice(0, 7))}&month2=${encodeURIComponent(($("adv-cmp-m2")?.value || ym).slice(0, 7))}`;
    }
    if (pane === "qarkullimi") {
      const range = periodRange($("adv-turnover-period")?.value || "month", ($("adv-turnover-month")?.value || ym).slice(0, 7));
      return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    }
    if (pane === "punonjesit") {
      const range = periodRange($("adv-emp-period")?.value || "month", ($("adv-emp-month")?.value || ym).slice(0, 7), "adv-emp-from", "adv-emp-to");
      return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    }
    if (pane === "nderrimet") {
      const range = periodRange($("adv-shift-period")?.value || "month", ($("adv-shift-month")?.value || ym).slice(0, 7), "adv-shift-from", "adv-shift-to");
      return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    }
    return "";
  }

  const exportPath = {
    javore: "weekly",
    mujore: "monthly",
    krahasime: "comparison",
    trende: "trends",
    qarkullimi: "turnover",
    punonjesit: "staff",
    nderrimet: "shifts",
  };

  async function exportCsv(kind) {
    const pane = exportKind[kind] || activePane;
    const path = exportPath[pane];
    const qs = exportQuery(kind);
    const u = typeof lexoSesionin === "function" ? lexoSesionin() : null;
    const res = await fetch(`${typeof API === "string" ? API : ""}/api/reports/advanced/${path}/export/csv?${qs}`, {
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

  async function exportPdf(kind) {
    const pane = exportKind[kind] || activePane;
    const path = exportPath[pane];
    const qs = exportQuery(kind);
    const data = await api(`/api/reports/advanced/${path}/export/pdf?${qs}`);
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
    activePane = name;
    document.querySelectorAll("#panel-raporte-avancuara .adv-subtab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.advPane === name);
    });
    document.querySelectorAll("#panel-raporte-avancuara .adv-pane").forEach((el) => {
      el.hidden = el.dataset.advPane !== name;
    });
    if (name === "punonjesit") syncCustom("adv-emp-period", "adv-emp-custom-wrap", "adv-emp-month");
    if (name === "nderrimet") syncCustom("adv-shift-period", "adv-shift-custom-wrap", "adv-shift-month");
    const fn = loaders[name];
    if (fn) fn().catch((e) => setMsg(e.message || "Gabim", false));
  }

  function init() {
    const today = isoDate(new Date());
    const month = today.slice(0, 7);
    const prev = new Date();
    prev.setMonth(prev.getMonth() - 1);
    const prevMonth = isoDate(prev).slice(0, 7);
    if ($("adv-week-date") && !$("adv-week-date").value) $("adv-week-date").value = today;
    if ($("adv-month-picker") && !$("adv-month-picker").value) $("adv-month-picker").value = month;
    if ($("adv-cmp-m1") && !$("adv-cmp-m1").value) $("adv-cmp-m1").value = month;
    if ($("adv-cmp-m2") && !$("adv-cmp-m2").value) $("adv-cmp-m2").value = prevMonth;
    if ($("adv-turnover-month") && !$("adv-turnover-month").value) $("adv-turnover-month").value = month;
    if ($("adv-emp-month") && !$("adv-emp-month").value) $("adv-emp-month").value = month;
    if ($("adv-shift-month") && !$("adv-shift-month").value) $("adv-shift-month").value = month;
    if ($("adv-emp-from") && !$("adv-emp-from").value) $("adv-emp-from").value = `${month}-01`;
    if ($("adv-emp-to") && !$("adv-emp-to").value) $("adv-emp-to").value = today;
    if ($("adv-shift-from") && !$("adv-shift-from").value) $("adv-shift-from").value = `${month}-01`;
    if ($("adv-shift-to") && !$("adv-shift-to").value) $("adv-shift-to").value = today;
    document.querySelectorAll("#panel-raporte-avancuara .adv-subtab").forEach((btn) => {
      btn.addEventListener("click", () => showPane(btn.dataset.advPane));
    });
    $("btn-adv-week-load")?.addEventListener("click", () => loadWeekly().catch((e) => setMsg(e.message, false)));
    $("btn-adv-month-load")?.addEventListener("click", () => loadMonthly().catch((e) => setMsg(e.message, false)));
    $("btn-adv-cmp-load")?.addEventListener("click", () => loadComparison().catch((e) => setMsg(e.message, false)));
    $("btn-adv-trend-load")?.addEventListener("click", () => loadTrends().catch((e) => setMsg(e.message, false)));
    $("btn-adv-turnover-load")?.addEventListener("click", () => loadTurnover().catch((e) => setMsg(e.message, false)));
    $("btn-adv-emp-load")?.addEventListener("click", () => loadEmployees().catch((e) => setMsg(e.message, false)));
    $("btn-adv-shift-load")?.addEventListener("click", () => loadShifts().catch((e) => setMsg(e.message, false)));
    $("adv-emp-period")?.addEventListener("change", () => syncCustom("adv-emp-period", "adv-emp-custom-wrap", "adv-emp-month"));
    $("adv-shift-period")?.addEventListener("change", () => syncCustom("adv-shift-period", "adv-shift-custom-wrap", "adv-shift-month"));
    document.querySelectorAll("#panel-raporte-avancuara [data-adv-csv]").forEach((btn) => {
      btn.addEventListener("click", () => exportCsv(btn.dataset.advCsv).catch((e) => setMsg(e.message, false)));
    });
    document.querySelectorAll("#panel-raporte-avancuara [data-adv-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => exportPdf(btn.dataset.advPdf).catch((e) => setMsg(e.message, false)));
    });
    document.querySelectorAll("#panel-raporte-avancuara .adv-pane").forEach((el) => {
      el.hidden = el.dataset.advPane !== "javore";
    });
  }

  window.HotelAdvancedReports = {
    init,
    load() {
      const fn = loaders[activePane] || loadWeekly;
      return fn().catch((e) => setMsg(e.message || "Gabim", false));
    },
  };
  if (document.getElementById("panel-raporte-avancuara")) init();
})();
