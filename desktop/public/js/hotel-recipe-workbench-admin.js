/** Admin — tab PËRBËRËSIT E RECETAVE (HOTEL desktop). */
(function (global) {
  const state = {
    items: [],
    selectedId: null,
    lines: [],
    loadedDesc: "",
    descTouched: false,
    sellPrice: 0,
  };

  function fmt(n, dec) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return v.toFixed(dec == null ? 2 : dec).replace(/\.?0+$/, "");
  }

  function displayUnitFor(ingUnit) {
    const u = String(ingUnit || "copë").trim();
    if (u === "kg") return "g";
    if (u === "l") return "ml";
    return "copë";
  }

  function internalQtyFromDisplay(qtyDisplay, ingUnit) {
    const q = Number(qtyDisplay);
    if (!(q > 0)) return 0;
    const u = String(ingUnit || "copë");
    if (u === "kg") return q / 1000;
    if (u === "l") return q / 1000;
    return q;
  }

  function displayQtyFromInternal(qtyInternal, ingUnit) {
    const q = Number(qtyInternal);
    if (!(q > 0)) return "";
    const u = String(ingUnit || "copë");
    if (u === "kg") return Math.round(q * 1000 * 1000) / 1000;
    if (u === "l") return Math.round(q * 1000 * 1000) / 1000;
    return q;
  }

  function ingById(id) {
    const list = global.HotelIngredientsRecipes?.loadIngredients
      ? null
      : null;
    return (global.__recipeWbIngredients || []).find((x) => Number(x.id) === Number(id));
  }

  async function ensureIngredients() {
    if (global.HotelIngredientsRecipes) {
      global.__recipeWbIngredients = await HotelIngredientsRecipes.loadIngredients();
    } else {
      const data = await global.api("/api/ingredients");
      global.__recipeWbIngredients = data.ingredients || [];
    }
    return global.__recipeWbIngredients;
  }

  function ingredientOptions(selectedId) {
    return typeof HotelIngredientsRecipes?.ingredientOptionsHtml === "function"
      ? HotelIngredientsRecipes.ingredientOptionsHtml(selectedId)
      : '<option value="">—</option>';
  }

  function suggestedDescription(lines) {
    const parts = [];
    for (const ln of lines) {
      const iid = Number(ln.ingredient_id);
      if (!iid) continue;
      const ing = ingById(iid);
      const name = String(ing?.name || ln.new_name || "").trim();
      if (!name) continue;
      const ingUnit = ing?.unit || ln.new_unit || "copë";

      let displayQty = null;
      if (Number(ln.quantity_used) > 0) {
        displayQty = displayQtyFromInternal(ln.quantity_used, ingUnit);
      } else if (ln.mode === "yield") {
        const portions = Number(ln.yield_portions);
        if (portions > 0) displayQty = displayQtyFromInternal(1 / portions, ingUnit);
      } else if (Number(ln.display_qty) > 0) {
        displayQty = Number(ln.display_qty);
      }

      let qtyLabel = "";
      const q = Number(displayQty);
      if (Number.isFinite(q) && q > 0) {
        const abbr = displayUnitFor(ingUnit);
        if (abbr === "g" || abbr === "ml") {
          const n = Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : fmt(q, 1);
          qtyLabel = `${n}${abbr}`;
        } else {
          const n = Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : fmt(q, 2);
          qtyLabel = `${n} copë`;
        }
      }

      parts.push(qtyLabel ? `${name} ${qtyLabel}` : name);
    }
    return parts.join(", ");
  }

  function defaultLine() {
    return {
      mode: "amount",
      ingredient_id: "",
      display_qty: 100,
      yield_portions: 4,
      new_name: "",
      new_unit: "kg",
    };
  }

  function linesToApiPayload(lines) {
    const out = [];
    for (const ln of lines) {
      let iid = Number(ln.ingredient_id);
      if (!iid && ln.new_name?.trim()) {
        throw new Error(`Përbërësi «${ln.new_name}» duhet krijuar — ruani rreshtin së pari ose zgjidhni përbërës.`);
      }
      if (!iid) continue;
      const ing = ingById(iid);
      const unit = ing?.unit || "copë";
      let internal = 0;
      if (ln.mode === "yield") {
        const n = Number(ln.yield_portions);
        if (!(n > 0)) continue;
        internal = 1 / n;
        if (unit === "copë") internal = 1 / n;
      } else {
        internal = internalQtyFromDisplay(ln.display_qty, unit);
      }
      if (internal > 0) out.push({ ingredient_id: iid, quantity_used: internal });
    }
    return out;
  }

  async function ensureLineIngredient(ln) {
    if (Number(ln.ingredient_id)) return ln;
    const nm = String(ln.new_name || "").trim();
    if (!nm) return ln;
    const created = await global.api("/api/ingredients", {
      method: "POST",
      body: JSON.stringify({
        name: nm,
        unit: ln.new_unit || "kg",
        min_stock_qty: 0,
      }),
    });
    ln.ingredient_id = created.ingredient?.id;
    await ensureIngredients();
    return ln;
  }

  function renderStats(recipe) {
    const el = document.getElementById("recipe-wb-stats");
    if (!el) return;
    if (!recipe?.has_recipe) {
      el.textContent = "Pa recetë — shitja zbrit stokun e artikullit (copë).";
      return;
    }
    el.textContent =
      `Kosto/porcion: ${fmt(recipe.portion_cost, 2)} € · ` +
      `Fitim/porcion: ${fmt(recipe.profit_per_portion, 2)} € · ` +
      `Porcione nga stoku: ${recipe.portions_available ?? "—"}`;
  }

  function renderLines() {
    const host = document.getElementById("recipe-wb-lines");
    if (!host) return;
    host.innerHTML = state.lines
      .map((ln, i) => {
        const ing = ln.ingredient_id ? ingById(ln.ingredient_id) : null;
        const dispUnit = displayUnitFor(ing?.unit || ln.new_unit);
        const showNew = !ln.ingredient_id;
        return `<div class="recipe-wb-line card" data-i="${i}" style="padding:0.5rem;margin:0.35rem 0">
          <div class="form-row" style="flex-wrap:wrap;align-items:flex-end;gap:0.35rem">
            <div style="min-width:140px">
              <label class="field-hint">Mënyra</label>
              <select class="recipe-wb-mode" data-i="${i}">
                <option value="amount"${ln.mode === "amount" ? " selected" : ""}>Sasi / porcion</option>
                <option value="yield"${ln.mode === "yield" ? " selected" : ""}>Nga 1 kg/l → porcione</option>
              </select>
            </div>
            <div style="min-width:160px">
              <label class="field-hint">Emri i përbërësit</label>
              <select class="recipe-wb-ing" data-i="${i}" ${showNew ? "hidden" : ""}>${ingredientOptions(ln.ingredient_id)}</select>
              <input type="text" class="recipe-wb-new-name" data-i="${i}" placeholder="Emër i ri" value="${ln.new_name || ""}" ${showNew ? "" : "hidden"}>
            </div>
            <div style="min-width:90px" class="recipe-wb-new-unit-wrap" data-i="${i}" ${showNew ? "" : "hidden"}>
              <label class="field-hint">Njësia (g, ml, copë)</label>
              <select class="recipe-wb-new-unit" data-i="${i}">
                <option value="kg"${(ln.new_unit || "kg") === "kg" ? " selected" : ""}>kg</option>
                <option value="l"${ln.new_unit === "l" ? " selected" : ""}>l</option>
                <option value="copë"${ln.new_unit === "copë" ? " selected" : ""}>copë</option>
              </select>
            </div>
            <div class="recipe-wb-amt-wrap" data-i="${i}" ${ln.mode === "yield" ? "hidden" : ""}>
              <label class="field-hint">Sasia · ${dispUnit} (për 1 porcion)</label>
              <input type="number" class="recipe-wb-qty" data-i="${i}" min="0.001" step="any" placeholder="p.sh. 250" value="${ln.display_qty ?? ""}">
            </div>
            <div class="recipe-wb-yield-wrap" data-i="${i}" ${ln.mode === "yield" ? "" : "hidden"}>
              <label class="field-hint">Porcione nga 1 ${ing?.unit === "l" ? "l" : ing?.unit === "copë" ? "copë" : "kg"}</label>
              <input type="number" class="recipe-wb-yield" data-i="${i}" min="1" step="1" value="${ln.yield_portions ?? 4}">
            </div>
            <button type="button" class="btn btn-ghost btn-sm recipe-wb-rm" data-i="${i}">×</button>
          </div>
          <button type="button" class="btn btn-ghost btn-sm recipe-wb-create-ing" data-i="${i}" ${showNew ? "" : "hidden"}>Krijo përbërësin</button>
        </div>`;
      })
      .join("");

    host.querySelectorAll(".recipe-wb-mode").forEach((sel) => {
      sel.addEventListener("change", () => {
        const i = Number(sel.dataset.i);
        state.lines[i].mode = sel.value === "yield" ? "yield" : "amount";
        renderLines();
      });
    });
    host.querySelectorAll(".recipe-wb-ing").forEach((sel) => {
      sel.addEventListener("change", () => {
        const i = Number(sel.dataset.i);
        state.lines[i].ingredient_id = sel.value;
        renderLines();
      });
    });
    host.querySelectorAll(".recipe-wb-new-name").forEach((inp) => {
      inp.addEventListener("input", () => {
        state.lines[Number(inp.dataset.i)].new_name = inp.value;
      });
    });
    host.querySelectorAll(".recipe-wb-new-unit").forEach((sel) => {
      sel.addEventListener("change", () => {
        state.lines[Number(sel.dataset.i)].new_unit = sel.value;
      });
    });
    host.querySelectorAll(".recipe-wb-qty").forEach((inp) => {
      inp.addEventListener("input", () => {
        state.lines[Number(inp.dataset.i)].display_qty = Number(inp.value);
      });
    });
    host.querySelectorAll(".recipe-wb-yield").forEach((inp) => {
      inp.addEventListener("input", () => {
        state.lines[Number(inp.dataset.i)].yield_portions = Number(inp.value);
      });
    });
    host.querySelectorAll(".recipe-wb-rm").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.lines.splice(Number(btn.dataset.i), 1);
        renderLines();
      });
    });
    host.querySelectorAll(".recipe-wb-create-ing").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.dataset.i);
        try {
          await ensureLineIngredient(state.lines[i]);
          renderLines();
        } catch (e) {
          alert(e.message || "Gabim");
        }
      });
    });
  }

  function clearWorkbenchTabMessages() {
    const ingMsg = document.getElementById("recipe-wb-ing-msg");
    const wbMsg = document.getElementById("recipe-wb-msg");
    if (ingMsg) ingMsg.textContent = "";
    if (wbMsg) wbMsg.textContent = "";
  }

  function ingredientNameExists(name) {
    const nm = String(name || "").trim().toLowerCase();
    if (!nm) return false;
    return (global.__recipeWbIngredients || []).some(
      (ing) => String(ing.name || "").trim().toLowerCase() === nm,
    );
  }

  async function addIngredientFromForm() {
    const msg = document.getElementById("recipe-wb-ing-msg");
    const nameInp = document.getElementById("recipe-wb-ing-new-name");
    const unitSel = document.getElementById("recipe-wb-ing-new-unit");
    const nm = String(nameInp?.value || "").trim();
    if (!nm) {
      if (msg) msg.textContent = "Shkruani emrin e përbërësit.";
      return;
    }
    await ensureIngredients();
    if (ingredientNameExists(nm)) {
      if (msg) msg.textContent = "Ky përbërës ekziston.";
      return;
    }
    const unit = String(unitSel?.value || "kg").trim();
    try {
      await global.api("/api/ingredients", {
        method: "POST",
        body: JSON.stringify({ name: nm, unit, min_stock_qty: 0 }),
      });
      if (msg) msg.textContent = `U shtua: ${nm}`;
      if (nameInp) nameInp.value = "";
      await ensureIngredients();
      renderLines();
      await renderIngredientsManage();
      if (global.HotelIngredientsRecipes?.renderIngredientsPanel) {
        HotelIngredientsRecipes.renderIngredientsPanel().catch(() => {});
      }
    } catch (e) {
      if (msg) msg.textContent = e.message || "Gabim";
    }
  }

  async function renderIngredientsManage() {
    const host = document.getElementById("recipe-wb-ing-list");
    const msg = document.getElementById("recipe-wb-ing-msg");
    if (!host) return;
    await ensureIngredients();
    const q = String(document.getElementById("recipe-wb-ing-search")?.value || "")
      .trim()
      .toLowerCase();
    let list = global.__recipeWbIngredients || [];
    if (q) list = list.filter((ing) => String(ing.name || "").toLowerCase().includes(q));
    if (!list.length) {
      host.innerHTML =
        '<p class="field-hint">Ende nuk ke shtuar asnjë lëndë të parë — fillo me butonin + Shto përbërës.</p>';
      return;
    }
    host.innerHTML = `<table class="purchases-table" style="width:100%">
      <thead><tr><th>Emri</th><th>Njësia</th><th>Stoku</th><th></th></tr></thead>
      <tbody>${list
        .map(
          (ing) => `<tr>
            <td>${ing.name}</td>
            <td>${ing.unit}</td>
            <td class="n">${fmt(ing.stock_qty, 3)}</td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-ghost btn-sm" data-ing-rename="${ing.id}">Ndrysho emrin</button>
              <button type="button" class="btn btn-danger btn-sm" data-ing-del="${ing.id}">Fshi</button>
            </td>
          </tr>`,
        )
        .join("")}</tbody></table>`;

    host.querySelectorAll("[data-ing-rename]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const iid = Number(btn.dataset.ingRename);
        const cur = ingById(iid);
        const neu = global.prompt("Emri i ri i përbërësit:", cur?.name || "");
        if (neu == null) return;
        const nm = String(neu).trim();
        if (!nm) {
          alert("Emri nuk mund të jetë bosh.");
          return;
        }
        try {
          await global.api(`/api/ingredients/${iid}`, {
            method: "PUT",
            body: JSON.stringify({ name: nm }),
          });
          if (msg) msg.textContent = "Emri u ndryshua.";
          await ensureIngredients();
          renderLines();
          await renderIngredientsManage();
          if (global.HotelIngredientsRecipes?.renderIngredientsPanel) {
            HotelIngredientsRecipes.renderIngredientsPanel().catch(() => {});
          }
        } catch (e) {
          alert(e.message || "Nuk u ndryshua.");
        }
      });
    });

    host.querySelectorAll("[data-ing-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const iid = Number(btn.dataset.ingDel);
        const cur = ingById(iid);
        if (!global.confirm(`Fshi përbërësin «${cur?.name || iid}»?`)) return;
        try {
          await global.api(`/api/ingredients/${iid}`, { method: "DELETE" });
          if (msg) msg.textContent = "U fshi.";
          await ensureIngredients();
          renderLines();
          await renderIngredientsManage();
          if (global.HotelIngredientsRecipes?.renderIngredientsPanel) {
            HotelIngredientsRecipes.renderIngredientsPanel().catch(() => {});
          }
        } catch (e) {
          alert(e.message || "Nuk u fshi.");
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function purgeProductFromList(id, name) {
    const label = String(name || `#${id}`).trim();
    const typed = global.prompt(
      `Do të fshihet produkti «${label}» nga menuja (pa kthim).\nShkruani FSHIJ për të konfirmuar:`,
      "",
    );
    if (typed == null || String(typed).trim() !== "FSHIJ") return;
    try {
      await global.api(`/api/menu/${id}/purge`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: "FSHIJ" }),
      });
      if (state.selectedId === id) {
        state.selectedId = null;
        document.getElementById("recipe-wb-editor")?.setAttribute("hidden", "");
      }
      const msg = document.getElementById("recipe-wb-msg");
      if (msg) msg.textContent = "Produkti u fshi.";
      await loadList();
      if (typeof global.ngarkoMenu === "function") {
        await global.ngarkoMenu();
      }
    } catch (e) {
      alert(e.message || "Produkti nuk u fshi.");
    }
  }

  async function loadList() {
    const q = document.getElementById("recipe-wb-search")?.value?.trim() || "";
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    const data = await global.api(`/api/menu/recipe-workbench${qs}`);
    state.items = data.items || [];
    const list = document.getElementById("recipe-wb-list");
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<p class="field-hint" style="padding:0.5rem">Nuk u gjet produkt.</p>';
      return;
    }
    list.innerHTML = `<table class="purchases-table" style="width:100%">
      <thead><tr>
        <th>Receta</th>
        <th>Produkti</th>
        <th>Kategoria</th>
        <th>Çmimi</th>
        <th>Kosto/porcion</th>
        <th>Porcione nga stoku</th>
        <th></th>
      </tr></thead>
      <tbody>${state.items
        .map(
          (it) => `<tr data-pick="${it.id}" style="cursor:pointer${state.selectedId === it.id ? ";background:rgba(255,140,0,0.12)" : ""}">
            <td>${
              it.has_recipe
                ? '<span style="color:#4ade80;font-weight:600">Ka recetë</span>'
                : '<span style="color:#9ca3af">Pa recetë — kliko për të shtuar</span>'
            }</td>
            <td>${escapeHtml(it.name)}</td>
            <td>${escapeHtml(it.category || "")}</td>
            <td class="n">${
              Number(it.price) > 0
                ? `${fmt(it.price, 2)} €`
                : `0 €<br><span class="field-hint" style="font-size:0.72rem;font-weight:400">Çmimi vendoset te Menuja</span>`
            }</td>
            <td class="n">${it.portion_cost != null ? `${fmt(it.portion_cost, 2)} €` : "—"}</td>
            <td class="n">${it.portions_available ?? "—"}</td>
            <td style="white-space:nowrap;text-align:right">
              <button type="button" class="btn btn-danger btn-sm" data-prod-del="${it.id}" title="Fshi produktin nga menuja">Fshi</button>
            </td>
          </tr>`,
        )
        .join("")}</tbody></table>`;
    list.querySelectorAll("[data-pick]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-prod-del]")) return;
        selectProduct(Number(row.dataset.pick));
      });
    });
    list.querySelectorAll("[data-prod-del]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = Number(btn.dataset.prodDel);
        const item = state.items.find((x) => x.id === id);
        purgeProductFromList(id, item?.name).catch(() => {});
      });
    });
  }

  async function selectProduct(id) {
    state.selectedId = id;
    state.descTouched = false;
    await ensureIngredients();
    const data = await global.api(`/api/menu/${id}/recipe`);
    const recipe = data.recipe || {};
    state.sellPrice = Number(recipe.sell_price) || 0;
    state.loadedDesc = String(recipe.description || "").trim();
    const descEl = document.getElementById("recipe-wb-desc");
    if (descEl) {
      descEl.value = state.loadedDesc;
      descEl.oninput = () => {
        state.descTouched = true;
      };
    }
    document.getElementById("recipe-wb-editor")?.removeAttribute("hidden");
    const item = state.items.find((x) => x.id === id);
    const title = document.getElementById("recipe-wb-editor-title");
    if (title) title.textContent = item ? `${item.name} (${item.category})` : `Produkt #${id}`;
    state.lines = (recipe.lines || []).map((ln) => ({
      mode: "amount",
      ingredient_id: ln.ingredient_id,
      display_qty: displayQtyFromInternal(ln.quantity_used, ln.ingredient_unit),
      yield_portions: 4,
      new_name: "",
      new_unit: ln.ingredient_unit || "kg",
    }));
    if (!state.lines.length) state.lines = [defaultLine()];
    renderLines();
    renderStats(recipe);
    await loadList();
  }

  async function saveWorkbench() {
    const msg = document.getElementById("recipe-wb-msg");
    const id = state.selectedId;
    if (!id) return;
    try {
      for (let i = 0; i < state.lines.length; i += 1) {
        if (!state.lines[i].ingredient_id && state.lines[i].new_name?.trim()) {
          await ensureLineIngredient(state.lines[i]);
        }
      }
      const apiLines = linesToApiPayload(state.lines);
      const suggested = suggestedDescription(
        apiLines.map((l) => ({ ingredient_id: l.ingredient_id })),
      );
      let desc = document.getElementById("recipe-wb-desc")?.value?.trim() || "";
      if (!desc && suggested) {
        desc = suggested;
      } else if (suggested && desc !== suggested && state.descTouched) {
        if (
          global.confirm(
            "Përshkrimi u ndryshua manualisht. Zëvendëso me emrat e përbërësve? (Anulo = mbaj tekstin)",
          )
        ) {
          desc = suggested;
        }
      } else if (suggested && !state.descTouched && !state.loadedDesc) {
        desc = suggested;
      }

      await global.api(`/api/menu/${id}/recipe`, {
        method: "PUT",
        body: JSON.stringify({ lines: apiLines }),
      });
      if (desc !== state.loadedDesc) {
        await global.api(`/api/menu/${id}`, {
          method: "PUT",
          body: JSON.stringify({ description: desc }),
        });
      }
      state.loadedDesc = desc;
      state.descTouched = false;
      if (msg) msg.textContent = "U ruajt.";
      const refreshed = await global.api(`/api/menu/${id}/recipe`);
      renderStats(refreshed.recipe || {});
      await loadList();
      if (global.HotelIngredientsRecipes?.renderIngredientsPanel) {
        HotelIngredientsRecipes.renderIngredientsPanel().catch(() => {});
      }
    } catch (e) {
      if (msg) msg.textContent = e.message || "Gabim";
    }
  }

  function bindUi() {
    document.getElementById("recipe-wb-reload")?.addEventListener("click", () => {
      loadList().catch(() => {});
    });
    document.getElementById("recipe-wb-search")?.addEventListener("input", () => {
      loadList().catch(() => {});
    });
    document.getElementById("recipe-wb-add-line")?.addEventListener("click", () => {
      state.lines.push(defaultLine());
      renderLines();
    });
    document.getElementById("recipe-wb-fill-desc")?.addEventListener("click", async () => {
      try {
        for (const ln of state.lines) {
          if (!ln.ingredient_id && ln.new_name?.trim()) await ensureLineIngredient(ln);
        }
        const apiLines = linesToApiPayload(state.lines);
        const suggested = suggestedDescription(apiLines);
        const descEl = document.getElementById("recipe-wb-desc");
        if (descEl) descEl.value = suggested;
        state.descTouched = false;
      } catch (e) {
        alert(e.message || "Gabim");
      }
    });
    document.getElementById("recipe-wb-save")?.addEventListener("click", () => {
      saveWorkbench().catch(() => {});
    });
    document.getElementById("recipe-wb-ing-search")?.addEventListener("input", () => {
      renderIngredientsManage().catch(() => {});
    });
    document.getElementById("recipe-wb-ing-add")?.addEventListener("click", () => {
      addIngredientFromForm().catch(() => {});
    });
    document.getElementById("recipe-wb-ing-new-name")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addIngredientFromForm().catch(() => {});
      }
    });
    const panel = document.getElementById("panel-receta-perberesit");
    if (panel) {
      const obs = new MutationObserver(() => {
        if (panel.classList.contains("active")) {
          clearWorkbenchTabMessages();
          loadList().catch(() => {});
          ensureIngredients().then(() => renderIngredientsManage()).catch(() => {});
        }
      });
      obs.observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindUi();
  });
})(window);
