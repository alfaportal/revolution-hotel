/** Owner phone — waiter rating, stock predict, weekly reports (Pako 4) */
(function () {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function api(path, opts) {
    if (typeof window.ownerApi === "function") return window.ownerApi(path, opts);
    const token = localStorage.getItem("owner_token") || "";
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...opts, headers, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.gabim || data.message || `HTTP ${res.status}`);
    return data;
  }

  function setHubExtra(html) {
    const el = document.getElementById("owner-ai-modules");
    if (el) el.innerHTML = html;
  }

  async function loadWaiterBlock() {
    try {
      const data = await api("/api/owner/ai-waiter-rating?days=30");
      const rows = (data.waiters || [])
        .slice(0, 8)
        .map(
          (w) =>
            `<li><strong>${esc(w.waiter_name)}</strong> — ${w.rating}/10 · refuzime ${w.refuse_events} (${w.refuse_rate_percent}%)</li>`,
        )
        .join("");
      return (
        `<div class="card" style="margin-top:0.75rem">` +
        `<div class="card-title card-title-row"><span>Kamarierët</span>` +
        `<button type="button" class="btn btn-ghost btn-sm" id="btn-owner-waiter-ai">Analizo AI</button></div>` +
        `<ul id="owner-waiter-list" style="margin:0.5rem 0 0;padding-left:1.1rem">${rows || "<li>Nuk ka të dhëna</li>"}</ul>` +
        `<p id="owner-waiter-analysis" class="links-hint" style="margin-top:0.5rem"></p></div>`
      );
    } catch (err) {
      return `<div class="card" style="margin-top:0.75rem"><p class="owner-license-msg err">${esc(err.message)}</p></div>`;
    }
  }

  async function loadStockBlock() {
    try {
      const data = await api("/api/owner/ai-stock-predict?days=30");
      const rows = (data.critical_items || [])
        .slice(0, 8)
        .map(
          (c) =>
            `<li><strong>${esc(c.name)}</strong> — ${c.current_quantity} ${esc(c.unit || "")}` +
            (c.recommend_order ? ` · porositi ${c.recommend_order}` : "") +
            `</li>`,
        )
        .join("");
      return (
        `<div class="card" style="margin-top:0.75rem">` +
        `<div class="card-title card-title-row"><span>Stok kritik</span>` +
        `<button type="button" class="btn btn-ghost btn-sm" id="btn-owner-stock-ai">Analizo AI</button></div>` +
        `<ul style="margin:0.5rem 0 0;padding-left:1.1rem">${rows || "<li>Asnjë produkt kritik</li>"}</ul>` +
        `<p id="owner-stock-analysis" class="links-hint" style="margin-top:0.5rem"></p></div>`
      );
    } catch (err) {
      return `<div class="card" style="margin-top:0.75rem"><p class="owner-license-msg err">${esc(err.message)}</p></div>`;
    }
  }

  async function loadWeeklyBlock() {
    try {
      const data = await api("/api/owner/ai-weekly-reports?limit=3");
      const rows = (data.reports || [])
        .map(
          (r) =>
            `<div style="margin-top:0.5rem"><strong>${esc(r.week_start)} → ${esc(r.week_end)}</strong>` +
            `<p class="links-hint" style="margin:0.25rem 0 0;white-space:pre-wrap">${esc((r.summary_text || "").slice(0, 280))}</p></div>`,
        )
        .join("");
      return (
        `<div class="card" style="margin-top:0.75rem">` +
        `<div class="card-title">Raporte javore</div>${rows || "<p class='links-hint'>Nuk ka raporte ende.</p>"}</div>`
      );
    } catch (err) {
      return `<div class="card" style="margin-top:0.75rem"><p class="owner-license-msg err">${esc(err.message)}</p></div>`;
    }
  }

  async function refreshOwnerAiModules() {
    const host = document.getElementById("owner-ai-modules");
    if (!host) return;
    host.innerHTML = "<p class='links-hint'>Duke ngarkuar modulet AI…</p>";
    const [w, s, week] = await Promise.all([loadWaiterBlock(), loadStockBlock(), loadWeeklyBlock()]);
    setHubExtra(w + s + week);

    document.getElementById("btn-owner-waiter-ai")?.addEventListener("click", async () => {
      const el = document.getElementById("owner-waiter-analysis");
      if (el) el.textContent = "Duke analizuar…";
      try {
        const r = await api("/api/owner/ai-waiter-rating/analyze", {
          method: "POST",
          body: JSON.stringify({ days: 30, force: true }),
        });
        if (el) el.textContent = r.analysis_text || "OK";
        if (typeof window.refreshOwnerAiUsage === "function") window.refreshOwnerAiUsage();
      } catch (err) {
        if (el) el.textContent = err.message;
      }
    });

    document.getElementById("btn-owner-stock-ai")?.addEventListener("click", async () => {
      const el = document.getElementById("owner-stock-analysis");
      if (el) el.textContent = "Duke analizuar…";
      try {
        const r = await api("/api/owner/ai-stock-predict/analyze", {
          method: "POST",
          body: JSON.stringify({ days: 30, send_email: true }),
        });
        if (el) el.textContent = r.analysis_text || "OK";
        if (typeof window.refreshOwnerAiUsage === "function") window.refreshOwnerAiUsage();
      } catch (err) {
        if (el) el.textContent = err.message;
      }
    });
  }

  window.refreshOwnerAiModules = refreshOwnerAiModules;
})();
