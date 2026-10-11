/** Admin — përbërësit, receta menu, blerje përbërësi (HOTEL desktop). */
(function (global) {
  let ingredientsCache = [];

  function fmt(n, dec) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return v.toFixed(dec == null ? 2 : dec).replace(/\.?0+$/, "");
  }

  async function loadIngredients() {
    const data = await global.api("/api/ingredients");
    ingredientsCache = Array.isArray(data.ingredients) ? data.ingredients : [];
    return ingredientsCache;
  }

  function ingredientOptionsHtml(selectedId) {
    let html = '<option value="">— Përbërës —</option>';
    for (const ing of ingredientsCache) {
      const sel = String(ing.id) === String(selectedId) ? " selected" : "";
      html += `<option value="${ing.id}"${sel}>${ing.name} (${ing.unit})</option>`;
    }
    return html;
  }

  async function renderIngredientsPanel() {
    const body = document.getElementById("ingredients-table-body");
    if (!body) return;
    try {
      await loadIngredients();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="6">${e.message || "Gabim"}</td></tr>`;
      return;
    }
    if (!ingredientsCache.length) {
      body.innerHTML =
        '<tr><td colspan="5" style="color:var(--ngjyr-muted)">Nuk ka përbërës — krijoni te tab-i PËRBËRËSIT E RECETAVE.</td></tr>';
      return;
    }
    body.innerHTML = ingredientsCache
      .map((ing) => {
        const cls =
          ing.negative_stock ? " style=\"color:#f87171\"" : ing.low_stock ? " style=\"color:#fbbf24\"" : "";
        return `<tr>
          <td>${ing.name}</td>
          <td>${ing.unit}</td>
          <td class="n"${cls}>${fmt(ing.stock_qty, 3)}</td>
          <td class="n">${fmt(ing.avg_cost_per_unit, 4)} €</td>
          <td class="n">${fmt(ing.min_stock_qty, 3)}</td>
        </tr>`;
      })
      .join("");
  }

  async function mountMenuRecipeEditor(card, menuItemId) {
    const host = card.querySelector(".menu-recipe-editor");
    if (!host) return;
    host.innerHTML = "<p class=\"field-hint\">Duke ngarkuar recetën…</p>";
    try {
      if (!ingredientsCache.length) await loadIngredients();
      const data = await global.api(`/api/menu/${menuItemId}/recipe`);
      const recipe = data.recipe || {};
      const lines = Array.isArray(recipe.lines) ? recipe.lines : [];
      host.innerHTML = `
        <div class="menu-recipe-block">
          <strong>Receta (përbërësit)</strong>
          <p class="field-hint">Shitja zbret përbërësit — jo stokun e artikullit të menusë.</p>
          <div class="menu-recipe-lines"></div>
          <button type="button" class="btn btn-ghost btn-sm menu-recipe-add-line">+ Përbërës</button>
          <div class="menu-recipe-stats" style="margin-top:0.5rem;font-size:0.85rem"></div>
          <button type="button" class="btn btn-primary btn-sm menu-recipe-save" style="margin-top:0.5rem">Ruaj recetën</button>
          <span class="menu-recipe-msg field-hint"></span>
        </div>`;
      const linesEl = host.querySelector(".menu-recipe-lines");
      const statsEl = host.querySelector(".menu-recipe-stats");

      function renderLines() {
        const current = host._recipeLines || [];
        linesEl.innerHTML = current
          .map(
            (ln, i) => `<div class="form-row" style="align-items:flex-end;gap:0.35rem;margin:0.25rem 0">
              <select class="menu-recipe-ing" data-i="${i}">${ingredientOptionsHtml(ln.ingredient_id)}</select>
              <input type="number" class="menu-recipe-qty" data-i="${i}" min="0.001" step="any" value="${ln.quantity_used}" placeholder="Sasia" title="Sasia për 1 porcion">
              <button type="button" class="btn btn-ghost btn-sm menu-recipe-rm" data-i="${i}">×</button>
            </div>`,
          )
          .join("");
        linesEl.querySelectorAll(".menu-recipe-ing").forEach((sel) => {
          sel.addEventListener("change", () => syncLinesFromDom());
        });
        linesEl.querySelectorAll(".menu-recipe-qty").forEach((inp) => {
          inp.addEventListener("input", () => syncLinesFromDom());
        });
        linesEl.querySelectorAll(".menu-recipe-rm").forEach((btn) => {
          btn.addEventListener("click", () => {
            const i = Number(btn.dataset.i);
            host._recipeLines.splice(i, 1);
            renderLines();
            updateStatsPreview();
          });
        });
      }

      function syncLinesFromDom() {
        const out = [];
        linesEl.querySelectorAll(".menu-recipe-ing").forEach((sel) => {
          const i = Number(sel.dataset.i);
          const qtyInp = linesEl.querySelector(`.menu-recipe-qty[data-i="${i}"]`);
          const iid = Number(sel.value);
          const q = Number(qtyInp?.value);
          if (iid && q > 0) out.push({ ingredient_id: iid, quantity_used: q });
        });
        host._recipeLines = out;
        updateStatsPreview();
      }

      function updateStatsPreview() {
        let cost = 0;
        let portions = Infinity;
        for (const ln of host._recipeLines || []) {
          const ing = ingredientsCache.find((x) => Number(x.id) === Number(ln.ingredient_id));
          if (!ing) continue;
          cost += Number(ln.quantity_used) * (Number(ing.avg_cost_per_unit) || 0);
          const p = Number(ing.stock_qty) / Number(ln.quantity_used);
          if (Number.isFinite(p)) portions = Math.min(portions, Math.floor(p));
        }
        if (!host._recipeLines?.length) {
          statsEl.textContent = "Pa recetë — stoku zbret si copë (artikull menu).";
          return;
        }
        const price = Number(recipe.sell_price) || 0;
        const pc = Math.round(cost * 100) / 100;
        const profit = Math.round((price - pc) * 100) / 100;
        const por =
          Number.isFinite(portions) && portions !== Infinity ? Math.max(0, portions) : "—";
        statsEl.textContent = `Kosto/porcion: ${pc.toFixed(2)} € · Fitim/porcion: ${profit.toFixed(2)} € · Porcione nga stoku: ${por}`;
      }

      host._recipeLines = lines.map((l) => ({
        ingredient_id: l.ingredient_id,
        quantity_used: l.quantity_used,
      }));
      renderLines();
      updateStatsPreview();

      host.querySelector(".menu-recipe-add-line")?.addEventListener("click", () => {
        host._recipeLines.push({ ingredient_id: "", quantity_used: 0.1 });
        renderLines();
      });

      host.querySelector(".menu-recipe-save")?.addEventListener("click", async () => {
        syncLinesFromDom();
        const msgEl = host.querySelector(".menu-recipe-msg");
        try {
          const res = await global.api(`/api/menu/${menuItemId}/recipe`, {
            method: "PUT",
            body: JSON.stringify({ lines: host._recipeLines }),
          });
          const r = res.recipe || {};
          if (msgEl) {
            msgEl.textContent = r.has_recipe
              ? `Ruajtur — kosto ${r.portion_cost} €, ${r.portions_available} porcione`
              : "Receta u pastrua.";
          }
          updateStatsPreview();
        } catch (err) {
          if (msgEl) msgEl.textContent = err.message || "Gabim";
        }
      });
    } catch (e) {
      host.innerHTML = `<p class="field-hint">${e.message || "Gabim recete"}</p>`;
    }
  }

  function patchPurchaseLineHelpers() {
    const origNew = global.newPurchaseLine;
    if (typeof origNew === "function" && !origNew._ingPatched) {
      global.newPurchaseLine = function patchedNewPurchaseLine() {
        const line = origNew();
        line.line_kind = "menu";
        line.ingredient_id = "";
        return line;
      };
      global.newPurchaseLine._ingPatched = true;
    }
  }

  function purchaseDescCellHtml(line, idx) {
    const kind = line.line_kind === "ingredient" ? "ingredient" : "menu";
    const prodFn = global.purchaseProductOptionsHtml;
    const prodHtml =
      typeof prodFn === "function" ? prodFn(line) : '<option value="">—</option>';
    return `<select class="purchase-line-kind" data-idx="${idx}" style="max-width:5.5rem;margin-bottom:0.25rem">
      <option value="menu"${kind === "menu" ? " selected" : ""}>Menu</option>
      <option value="ingredient"${kind === "ingredient" ? " selected" : ""}>Përbërës</option>
    </select>
    <select class="purchase-line-product" data-idx="${idx}" ${kind === "ingredient" ? "hidden" : ""}>${prodHtml}</select>
    <select class="purchase-line-ingredient" data-idx="${idx}" ${kind === "menu" ? "hidden" : ""}>${ingredientOptionsHtml(line.ingredient_id)}</select>`;
  }

  let stockCountTargets = [];

  async function loadStockCountTargets() {
    const data = await global.api("/api/stock-count/targets");
    stockCountTargets = Array.isArray(data.targets) ? data.targets : [];
    return stockCountTargets;
  }

  function renderStockCountLines() {
    const host = document.getElementById("stock-count-lines");
    if (!host) return;
    if (!stockCountTargets.length) {
      host.innerHTML = "<p class=\"field-hint\">Nuk ka rreshta — shtoni përbërës ose produkte pa recetë.</p>";
      return;
    }
    host.innerHTML = stockCountTargets
      .map(
        (t, i) => `<div class="form-row" style="align-items:center;gap:0.35rem;margin:0.2rem 0" data-sc-i="${i}">
          <span style="min-width:140px">${t.name} <small>(${t.unit})</small></span>
          <span class="field-hint">Sist: ${t.system_qty}</span>
          <input type="number" step="any" class="stock-count-qty" data-sc-i="${i}" value="${t.system_qty}" style="width:100px" aria-label="Sasia e numëruar">
        </div>`,
      )
      .join("");
  }

  async function saveStockCount() {
    const msg = document.getElementById("stock-count-msg");
    const lines = stockCountTargets.map((t, i) => {
      const inp = document.querySelector(`.stock-count-qty[data-sc-i="${i}"]`);
      return {
        target_type: t.target_type,
        target_id: t.target_id,
        name: t.name,
        unit: t.unit,
        counted_qty: Number(inp?.value),
      };
    });
    try {
      const note = document.getElementById("stock-count-note")?.value || "";
      const res = await global.api("/api/stock-count", {
        method: "POST",
        body: JSON.stringify({ lines, note }),
      });
      if (msg) {
        msg.textContent = `U ruajt (${res.lines?.length || 0} rreshta).`;
      }
      await loadStockCountTargets();
      renderStockCountLines();
      await renderIngredientsPanel();
    } catch (e) {
      if (msg) msg.textContent = e.message || "Gabim";
    }
  }

  async function loadVarianceReport() {
    const body = document.getElementById("variance-table-body");
    if (!body) return;
    const from = document.getElementById("variance-from")?.value;
    const to = document.getElementById("variance-to")?.value;
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      const data = await global.api("/api/inventory/consumption-variance" + (qs.toString() ? `?${qs}` : ""));
      const items = data.report?.items || [];
      if (!items.length) {
        body.innerHTML = '<tr><td colspan="6">Nuk ka të dhëna për këtë periudhë.</td></tr>';
        return;
      }
      body.innerHTML = items
        .map(
          (r) => `<tr>
            <td>${r.name}</td>
            <td class="n">${r.expected_used_qty} ${r.unit}</td>
            <td class="n">${r.actual_used_qty} ${r.unit}</td>
            <td class="n">${r.variance_qty} ${r.unit}</td>
            <td class="n">${Number(r.variance_value).toFixed(2)} €</td>
            <td class="n">${r.variance_pct}%</td>
          </tr>`,
        )
        .join("");
    } catch (e) {
      body.innerHTML = `<tr><td colspan="6">${e.message || "Gabim"}</td></tr>`;
    }
  }

  function initVarianceDates() {
    const toEl = document.getElementById("variance-to");
    const fromEl = document.getElementById("variance-from");
    if (!toEl || toEl.value) return;
    const to = typeof sotISO === "function" ? sotISO() : new Date().toISOString().slice(0, 10);
    const from = typeof addDaysISO === "function" ? addDaysISO(to, -6) : to;
    toEl.value = to;
    fromEl.value = from;
  }

  global.HotelIngredientsRecipes = {
    loadIngredients,
    renderIngredientsPanel,
    mountMenuRecipeEditor,
    patchPurchaseLineHelpers,
    purchaseDescCellHtml,
    ingredientOptionsHtml,
    loadStockCountTargets,
    renderStockCountLines,
    saveStockCount,
    loadVarianceReport,
  };

  document.addEventListener("DOMContentLoaded", () => {
    initVarianceDates();
    const stokuPanel = document.getElementById("panel-stoku");
    if (stokuPanel) {
      const obs = new MutationObserver(() => {
        if (stokuPanel.classList.contains("active")) {
          renderIngredientsPanel();
          loadStockCountTargets().then(renderStockCountLines).catch(() => {});
        }
      });
      obs.observe(stokuPanel, { attributes: true, attributeFilter: ["class"] });
    }
    document.getElementById("btn-stock-count-save")?.addEventListener("click", () => {
      saveStockCount().catch(() => {});
    });
    document.getElementById("btn-stock-count-reload")?.addEventListener("click", () => {
      loadStockCountTargets().then(renderStockCountLines).catch(() => {});
    });
    document.getElementById("btn-variance-load")?.addEventListener("click", () => {
      loadVarianceReport().catch(() => {});
    });
    patchPurchaseLineHelpers();
  });
})(window);
