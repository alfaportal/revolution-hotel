/** Owner panel — stock / inventory tab */
(function () {
  let stockCache = { items: [], summary: {}, synced_at: null };

  function setStockMsg(text, ok) {
    const msg = document.getElementById("stock-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function updateStockSyncHint(syncedAt) {
    const hint = document.getElementById("stock-sync-hint");
    if (!hint) return;
    hint.textContent = syncedAt
      ? `Sinkronizuar: ${typeof fmtTime === "function" ? fmtTime(syncedAt) : syncedAt} — POS/tabletat e marrin brenda ~15 sekondave.`
      : "Ndryshimet e stokut sinkronizohen me POS dhe tabletat.";
  }

  function updateStockTabBadge(summary) {
    const badge = document.getElementById("tab-stoku-badge");
    if (!badge) return;
    const count = Number(summary?.alert_count) || 0;
    badge.dataset.menuAlerts = String(count);
    const invAlerts = Number(badge.dataset.invAlerts) || 0;
    const total = count + invAlerts;
    if (total > 0) {
      badge.textContent = String(total);
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
    }
  }

  function stockStatusLabel(status) {
    if (status === "out") return "Mbaroi";
    if (status === "low") return "Stok i ulët";
    if (status === "unlimited") return "Pa limit";
    return "OK";
  }

  function renderStockSummary(summary) {
    const el = document.getElementById("stock-summary");
    if (!el) return;
    const low = Number(summary?.low_count) || 0;
    const out = Number(summary?.out_count) || 0;
    const tracked = Number(summary?.tracked_count) || 0;
    el.innerHTML = `
      <div class="stock-summary-grid">
        <div class="stock-summary-item"><strong>${tracked}</strong><span>Artikuj me stok</span></div>
        <div class="stock-summary-item${low ? " warn" : ""}"><strong>${low}</strong><span>Stok i ulët</span></div>
        <div class="stock-summary-item${out ? " danger" : ""}"><strong>${out}</strong><span>Mbaruar</span></div>
      </div>`;
  }

  function renderStockTable() {
    const body = document.getElementById("stock-items-body");
    if (!body) return;
    const items = stockCache.items || [];
    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="7" style="color:var(--muted)">Nuk ka artikuj në menu. Shtoni artikuj te skeda Menuja.</td></tr>';
      return;
    }

    body.innerHTML = items
      .map(item => {
        const rowClass =
          item.stock_status === "out"
            ? "stock-row-out"
            : item.stock_status === "low"
              ? "stock-row-low"
              : "";
        const qtyVal =
          item.track_stock && item.stock_quantity != null ? item.stock_quantity : "";
        return `<tr class="${rowClass}" data-id="${item.id}">
          <td><strong>${esc(item.name)}</strong></td>
          <td>${esc(item.category)}</td>
          <td class="stock-toggle-cell">
            <label class="stock-toggle">
              <input type="checkbox" class="stock-track-input" ${item.track_stock ? "checked" : ""}>
              <span>${item.track_stock ? "Po" : "Jo"}</span>
            </label>
          </td>
          <td>
            <input type="number" class="stock-qty-input" min="0" step="1" value="${qtyVal}" ${item.track_stock ? "" : "disabled"} placeholder="—">
          </td>
          <td>
            <input type="number" class="stock-threshold-input" min="0" step="1" value="${item.stock_alert_threshold}" ${item.track_stock ? "" : "disabled"}>
          </td>
          <td><span class="stock-status stock-status-${item.stock_status}">${stockStatusLabel(item.stock_status)}</span></td>
          <td>
            <div class="menu-row-actions">
              <button type="button" class="btn btn-primary btn-sm btn-stock-save">Ruaj</button>
              <button type="button" class="btn btn-ghost btn-sm btn-stock-restock" ${item.track_stock ? "" : "disabled"}>Rimbush Stokun</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".stock-track-input").forEach(input => {
      input.addEventListener("change", () => {
        const row = input.closest("tr");
        const on = input.checked;
        input.nextElementSibling.textContent = on ? "Po" : "Jo";
        row.querySelector(".stock-qty-input").disabled = !on;
        row.querySelector(".stock-threshold-input").disabled = !on;
        row.querySelector(".btn-stock-restock").disabled = !on;
      });
    });

    body.querySelectorAll(".btn-stock-save").forEach(btn => {
      btn.addEventListener("click", () => saveStockRow(btn.closest("tr")));
    });
    body.querySelectorAll(".btn-stock-restock").forEach(btn => {
      btn.addEventListener("click", () => restockRow(btn.closest("tr")));
    });
  }

  async function saveStockRow(row) {
    if (!row) return;
    const id = row.dataset.id;
    const track_stock = row.querySelector(".stock-track-input")?.checked;
    const stock_quantity = row.querySelector(".stock-qty-input")?.value;
    const stock_alert_threshold = row.querySelector(".stock-threshold-input")?.value;
    try {
      setStockMsg("");
      const body = {
        track_stock,
        stock_alert_threshold: Number(stock_alert_threshold),
      };
      if (track_stock) body.stock_quantity = Number(stock_quantity);
      const { item, synced_at } = await api(`/api/owner/stock/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const idx = stockCache.items.findIndex(i => i.id === id);
      if (idx >= 0) stockCache.items[idx] = item;
      stockCache.summary = summarizeFromItems(stockCache.items);
      renderStockTable();
      renderStockSummary(stockCache.summary);
      updateStockTabBadge(stockCache.summary);
      updateStockSyncHint(synced_at);
      setStockMsg("Stoku u ruajt.", true);
    } catch (err) {
      setStockMsg(err.message, false);
    }
  }

  async function restockRow(row) {
    if (!row) return;
    const id = row.dataset.id;
    const name = row.querySelector("strong")?.textContent || "artikullin";
    const raw = prompt(`Sa copë dëshironi të shtoni te "${name}"?`, "10");
    if (raw == null) return;
    const add = Number(raw);
    if (!Number.isFinite(add) || add <= 0) {
      setStockMsg("Shkruani një numër pozitiv.", false);
      return;
    }
    try {
      setStockMsg("");
      const { item, synced_at } = await api(`/api/owner/stock/${id}/restock`, {
        method: "POST",
        body: JSON.stringify({ add }),
      });
      const idx = stockCache.items.findIndex(i => i.id === id);
      if (idx >= 0) stockCache.items[idx] = item;
      stockCache.summary = summarizeFromItems(stockCache.items);
      renderStockTable();
      renderStockSummary(stockCache.summary);
      updateStockTabBadge(stockCache.summary);
      updateStockSyncHint(synced_at);
      setStockMsg(`U shtuan ${add} copë te "${item.name}".`, true);
    } catch (err) {
      setStockMsg(err.message, false);
    }
  }

  function summarizeFromItems(items) {
    let low_count = 0;
    let out_count = 0;
    let tracked_count = 0;
    for (const it of items) {
      if (!it.track_stock) continue;
      tracked_count += 1;
      if (it.stock_status === "low") low_count += 1;
      if (it.stock_status === "out") out_count += 1;
    }
    return { low_count, out_count, tracked_count, alert_count: low_count + out_count };
  }

  async function loadOwnerStock() {
    const data = await api("/api/owner/stock");
    stockCache = {
      items: data.items || [],
      summary: data.summary || {},
      synced_at: data.synced_at,
    };
    renderStockSummary(stockCache.summary);
    renderStockTable();
    updateStockTabBadge(stockCache.summary);
    updateStockSyncHint(data.synced_at);
  }

  async function refreshStockBadge() {
    try {
      const { summary } = await api("/api/owner/stock/summary");
      updateStockTabBadge(summary);
    } catch {
      /* optional */
    }
  }

  window.loadOwnerStock = loadOwnerStock;
  window.refreshStockBadge = refreshStockBadge;

  document.addEventListener("DOMContentLoaded", () => {
    refreshStockBadge();
  });
})();
