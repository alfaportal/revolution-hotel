/** Owner panel — Raporte AI ditore + Parashikim Fitimi */
(function () {
  let reportsCache = [];
  let profitForecastCache = null;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function euro(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0.00 €";
    return `${v.toFixed(2)} €`;
  }

  function pctLabel(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(1)}%`;
  }

  function deltaClass(n) {
    const v = Number(n);
    if (v > 0) return "up";
    if (v < 0) return "down";
    return "flat";
  }

  function setAiReportMsg(text, ok) {
    const el = document.getElementById("ai-report-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function renderProfitForecast(forecast) {
    profitForecastCache = forecast || null;
    const summaryEl = document.getElementById("profit-forecast-summary");
    const chartEl = document.getElementById("profit-forecast-chart");
    const compareEl = document.getElementById("profit-forecast-compare");
    const forecastEl = document.getElementById("profit-forecast-forecast");
    if (!summaryEl || !chartEl) return;

    if (!forecast || !forecast.daily_series?.length) {
      summaryEl.textContent = "Ende nuk ka të dhëna për parashikim — gjeneroni raportin AI ose rifreskoni.";
      chartEl.innerHTML = "";
      if (compareEl) compareEl.innerHTML = "";
      if (forecastEl) forecastEl.innerHTML = "";
      return;
    }

    summaryEl.textContent = forecast.ai_summary || "—";

    const series = forecast.daily_series;
    const maxProfit = Math.max(...series.map(d => Number(d.profit) || 0), 1);
    chartEl.innerHTML = series
      .map(d => {
        const h = Math.max(4, Math.round(((Number(d.profit) || 0) / maxProfit) * 100));
        const tip = `${d.date}: ${euro(d.profit)}`;
        return `<div class="profit-forecast-bar" style="height:${h}%" data-tip="${esc(tip)}" title="${esc(tip)}"></div>`;
      })
      .join("");

    const cmp = forecast.comparison || {};
    const tw = cmp.this_week || {};
    const pw = cmp.prev_week || {};
    const tm = cmp.this_month || {};
    const pm = cmp.prev_month || {};

    if (compareEl) {
      compareEl.innerHTML = `
        <div class="profit-forecast-box">
          <div class="title">Këtë javë (fitim)</div>
          <div class="val">${euro(tw.profit)}</div>
          <div class="delta ${deltaClass(pw.profit_change_pct)}">vs java e kaluar: ${pctLabel(pw.profit_change_pct)}</div>
        </div>
        <div class="profit-forecast-box">
          <div class="title">Java e kaluar (fitim)</div>
          <div class="val">${euro(pw.profit)}</div>
          <div class="delta flat">${Number(pw.orders || 0)} porosi</div>
        </div>
        <div class="profit-forecast-box">
          <div class="title">Këtë muaj (fitim)</div>
          <div class="val">${euro(tm.profit)}</div>
          <div class="delta ${deltaClass(pm.profit_change_pct)}">vs muaji i kaluar: ${pctLabel(pm.profit_change_pct)}</div>
        </div>
        <div class="profit-forecast-box">
          <div class="title">Muaji i kaluar (fitim)</div>
          <div class="val">${euro(pm.profit)}</div>
          <div class="delta flat">${Number(pm.orders || 0)} porosi</div>
        </div>`;
    }

    const fc = forecast.forecast || {};
    const nw = fc.next_week || {};
    const nm = fc.next_month || {};
    if (forecastEl) {
      forecastEl.innerHTML = `
        <div class="profit-forecast-box">
          <div class="title">Parashikim — java e ardhshme</div>
          <div class="val">${euro(nw.profit)}</div>
          <div class="delta flat">Shitje ~${euro(nw.revenue)}</div>
        </div>
        <div class="profit-forecast-box">
          <div class="title">Parashikim — muaji i ardhshëm</div>
          <div class="val">${euro(nm.profit)}</div>
          <div class="delta flat">Shitje ~${euro(nm.revenue)}</div>
        </div>`;
    }
  }

  function renderTodayReport(report, today) {
    const summaryEl = document.getElementById("ai-report-today-summary");
    const detailsEl = document.getElementById("ai-report-today-details");
    const metaEl = document.getElementById("ai-report-today-meta");
    if (!summaryEl || !detailsEl) return;

    if (!report) {
      metaEl.textContent = today ? `Data: ${today}` : "";
      summaryEl.textContent = "Ende nuk ka raport për sot. Raporti gjenerohet automatikisht në 23:59.";
      detailsEl.innerHTML = "";
      renderProfitForecast(null);
      return;
    }

    const json = report.report_json || {};
    const sales = json.sales || {};
    const profit = json.profit || {};
    metaEl.textContent = `Data: ${report.report_date}${report.email_sent_at ? " · Email u dërgua" : ""}`;
    summaryEl.textContent = report.summary_text || "—";
    detailsEl.innerHTML = `
      <div class="ai-report-stat"><div class="val">${euro(sales.total_revenue)}</div><div class="lbl">Shitje totale</div></div>
      <div class="ai-report-stat"><div class="val">${Number(sales.order_count || 0)}</div><div class="lbl">Porosi</div></div>
      <div class="ai-report-stat"><div class="val">${euro(profit.profit ?? sales.total_revenue)}</div><div class="lbl">Fitim i vlerësuar</div></div>
      <div class="ai-report-stat"><div class="val">${(json.top_items || []).length}</div><div class="lbl">Top artikuj</div></div>`;

    if (report.profit_forecast && Object.keys(report.profit_forecast).length) {
      renderProfitForecast(report.profit_forecast);
    }
  }

  function renderHistoryTable() {
    const body = document.getElementById("ai-reports-history-body");
    if (!body) return;
    if (!reportsCache.length) {
      body.innerHTML =
        '<tr><td colspan="5" style="color:var(--muted)">Nuk ka raporte ende — gjenerohen automatikisht çdo ditë.</td></tr>';
      return;
    }
    body.innerHTML = reportsCache
      .map(r => {
        const json = r.report_json || {};
        const sales = json.sales || {};
        const profit = json.profit || {};
        return `<tr>
          <td><strong>${esc(r.report_date)}</strong></td>
          <td>${euro(sales.total_revenue)}</td>
          <td>${Number(sales.order_count || 0)}</td>
          <td>${euro(profit.profit ?? sales.total_revenue)}</td>
          <td><button type="button" class="btn btn-ghost btn-sm btn-ai-report-view" data-date="${esc(r.report_date)}">Shiko</button></td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".btn-ai-report-view").forEach(btn => {
      btn.addEventListener("click", () => {
        const report = reportsCache.find(r => r.report_date === btn.dataset.date);
        if (report) {
          renderTodayReport(report, report.report_date);
          if (report.profit_forecast && Object.keys(report.profit_forecast).length) {
            renderProfitForecast(report.profit_forecast);
          }
        }
        setAiReportMsg(`U shfaq raporti për ${btn.dataset.date}.`, true);
      });
    });
  }

  async function loadProfitForecast() {
    try {
      const data = await api("/api/owner/ai-reports/profit-forecast");
      renderProfitForecast(data.profit_forecast);
    } catch (err) {
      renderProfitForecast(null);
      setAiReportMsg(err.message, false);
    }
  }

  async function refreshProfitForecast() {
    const btn = document.getElementById("btn-profit-forecast-refresh");
    if (btn) btn.disabled = true;
    setAiReportMsg("Duke llogaritur parashikimin…", true);
    try {
      const data = await api("/api/owner/ai-reports/profit-forecast/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
      renderProfitForecast(data.profit_forecast);
      setAiReportMsg("Parashikimi u përditësua.", true);
    } catch (err) {
      setAiReportMsg(err.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadOwnerAiReports() {
    setAiReportMsg("Duke ngarkuar…", true);
    try {
      const data = await api("/api/owner/ai-reports");
      reportsCache = data.reports || [];
      renderHistoryTable();

      const todayReport = reportsCache.find(r => r.report_date === data.today);
      renderTodayReport(todayReport, data.today);

      if (todayReport?.profit_forecast && Object.keys(todayReport.profit_forecast).length) {
        renderProfitForecast(todayReport.profit_forecast);
      } else {
        await loadProfitForecast();
      }
      setAiReportMsg("", true);
    } catch (err) {
      setAiReportMsg(err.message, false);
    }
  }

  window.loadOwnerAiReports = loadOwnerAiReports;

  function applyAiReportsTab(data) {
    window.applyAiFeatureLock?.(document.getElementById("tab-ai-reports"), data);
  }

  window.applyAiReportsTab = applyAiReportsTab;

  async function generateTodayReport(force = false) {
    const btn = document.getElementById("btn-ai-report-generate");
    if (btn) btn.disabled = true;
    setAiReportMsg("Duke gjeneruar raportin AI…", true);
    try {
      const data = await api("/api/owner/ai-reports/generate", {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      const report = data.report;
      if (report) {
        const idx = reportsCache.findIndex(r => r.report_date === report.report_date);
        if (idx >= 0) reportsCache[idx] = report;
        else reportsCache.unshift(report);
        renderHistoryTable();
        renderTodayReport(report, report.report_date);
        if (report.profit_forecast) renderProfitForecast(report.profit_forecast);
      }
      setAiReportMsg(
        data.skipped ? "Raporti për sot ekziston tashmë." : "Raporti AI u gjenerua me sukses.",
        true,
      );
    } catch (err) {
      setAiReportMsg(err.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById("btn-ai-report-generate")?.addEventListener("click", () => {
    generateTodayReport(false).catch(err => setAiReportMsg(err.message, false));
  });
  document.getElementById("btn-ai-report-refresh")?.addEventListener("click", () => {
    loadOwnerAiReports().catch(err => setAiReportMsg(err.message, false));
  });
  document.getElementById("btn-profit-forecast-refresh")?.addEventListener("click", () => {
    refreshProfitForecast().catch(err => setAiReportMsg(err.message, false));
  });
})();
