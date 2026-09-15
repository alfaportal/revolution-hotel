/** Owner panel — përbërësit / inventari */
(function () {
  let ingredientsCache = [];

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtQty(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return v % 1 === 0 ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  }

  function setInventoryMsg(text, ok) {
    const msg = document.getElementById("inventory-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function setIngredientModalMsg(text, ok) {
    const msg = document.getElementById("ingredient-modal-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function renderInventoryAlerts(alerts) {
    const el = document.getElementById("inventory-alerts");
    if (!el) return;
    if (!alerts?.length) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="inventory-alert-banner" role="alert">
        <strong>⚠ ${alerts.length} përbërës nën minimum:</strong>
        ${alerts.map(a => esc(a.name)).join(", ")}
      </div>`;
  }

  function updateInventoryTabBadge(count) {
    const badge = document.getElementById("tab-stoku-badge");
    if (!badge) return;
    badge.dataset.invAlerts = String(Number(count) || 0);
    const menuAlerts = Number(badge.dataset.menuAlerts) || 0;
    const total = menuAlerts + (Number(count) || 0);
    if (total > 0) {
      badge.textContent = String(total);
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
    }
  }

  function renderIngredientsTable() {
    const body = document.getElementById("ingredients-body");
    if (!body) return;
    if (!ingredientsCache.length) {
      body.innerHTML =
        '<tr><td colspan="7" style="color:var(--muted)">Nuk ka përbërës. Klikoni «Shto përbërës».</td></tr>';
      return;
    }

    body.innerHTML = ingredientsCache
      .map(item => {
        const rowClass = item.below_minimum ? "inventory-row-low" : "";
        const status = item.below_minimum
          ? '<span class="inventory-status inventory-status-low">Nën minimum</span>'
          : '<span class="inventory-status inventory-status-ok">OK</span>';
        return `<tr class="${rowClass}" data-id="${item.id}">
          <td><strong>${esc(item.name)}</strong></td>
          <td>${esc(item.unit)}</td>
          <td class="num">${fmtQty(item.quantity)}</td>
          <td class="num">${fmtQty(item.min_quantity)}</td>
          <td class="num">${Number(item.cost_per_unit || 0).toFixed(2)} €</td>
          <td>${status}</td>
          <td>
            <button type="button" class="btn btn-primary btn-sm btn-ingredient-restock">Përditëso sasinë</button>
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".btn-ingredient-restock").forEach(btn => {
      btn.addEventListener("click", () => restockIngredient(btn.closest("tr")));
    });
  }

  async function restockIngredient(row) {
    if (!row) return;
    const id = row.dataset.id;
    const item = ingredientsCache.find(i => i.id === id);
    const name = item?.name || "përbërësin";
    const unit = item?.unit || "";
    const raw = prompt(`Sa ${unit} dëshironi të shtoni te "${name}"? (furnizim)`, "10");
    if (raw == null) return;
    const add = Number(raw);
    if (!Number.isFinite(add) || add <= 0) {
      setInventoryMsg("Shkruani një numër pozitiv.", false);
      return;
    }
    try {
      setInventoryMsg("");
      const { ingredient } = await api(`/api/owner/ingredients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ add_quantity: add }),
      });
      const idx = ingredientsCache.findIndex(i => i.id === id);
      if (idx >= 0) ingredientsCache[idx] = ingredient;
      renderIngredientsTable();
      await refreshInventoryAlerts();
      setInventoryMsg(`U shtuan ${fmtQty(add)} ${unit} te "${ingredient.name}".`, true);
    } catch (err) {
      setInventoryMsg(err.message, false);
    }
  }

  async function refreshInventoryAlerts() {
    try {
      const { alerts, count } = await api("/api/owner/inventory/alerts");
      renderInventoryAlerts(alerts);
      updateInventoryTabBadge(count);
    } catch {
      /* optional */
    }
  }

  async function loadOwnerInventory() {
    setInventoryMsg("Duke ngarkuar…", true);
    try {
      const data = await api("/api/owner/ingredients");
      ingredientsCache = data.ingredients || [];
      renderIngredientsTable();
      await refreshInventoryAlerts();
      setInventoryMsg("", true);
    } catch (err) {
      setInventoryMsg(err.message, false);
    }
  }

  function openIngredientModal() {
    document.getElementById("ingredient-name").value = "";
    document.getElementById("ingredient-unit").value = "kg";
    document.getElementById("ingredient-quantity").value = "0";
    document.getElementById("ingredient-min").value = "5";
    document.getElementById("ingredient-cost").value = "0";
    setIngredientModalMsg("");
    document.getElementById("ingredient-modal")?.classList.remove("hidden");
  }

  function closeIngredientModal() {
    document.getElementById("ingredient-modal")?.classList.add("hidden");
  }

  async function saveIngredientFromModal() {
    const btn = document.getElementById("btn-ingredient-save");
    if (btn) btn.disabled = true;
    setIngredientModalMsg("Duke ruajtur…", true);
    try {
      const { ingredient } = await api("/api/owner/ingredients", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("ingredient-name")?.value?.trim(),
          unit: document.getElementById("ingredient-unit")?.value,
          quantity: Number(document.getElementById("ingredient-quantity")?.value),
          min_quantity: Number(document.getElementById("ingredient-min")?.value),
          cost_per_unit: Number(document.getElementById("ingredient-cost")?.value),
        }),
      });
      ingredientsCache.push(ingredient);
      ingredientsCache.sort((a, b) => a.name.localeCompare(b.name, "sq"));
      renderIngredientsTable();
      await refreshInventoryAlerts();
      closeIngredientModal();
      setInventoryMsg(`Përbërësi «${ingredient.name}» u shtua.`, true);
    } catch (err) {
      setIngredientModalMsg(err.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.loadOwnerInventory = loadOwnerInventory;
  window.refreshInventoryAlerts = refreshInventoryAlerts;

  document.getElementById("btn-ingredient-add")?.addEventListener("click", openIngredientModal);
  document.getElementById("ingredient-modal-close")?.addEventListener("click", closeIngredientModal);
  document.getElementById("ingredient-modal-backdrop")?.addEventListener("click", closeIngredientModal);
  document.getElementById("btn-ingredient-save")?.addEventListener("click", saveIngredientFromModal);

  document.addEventListener("DOMContentLoaded", () => {
    refreshInventoryAlerts().catch(() => {});
  });
})();
