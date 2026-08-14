/** Katalogu i artikujve — paneli i pronarit */
(function () {
  let catalogData = null;
  const selected = new Map();

  function setCatalogMsg(text, ok) {
    const el = document.getElementById("catalog-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function euro(n) {
    return Number(n || 0).toFixed(2) + " €";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function updateSelectedCount() {
    const el = document.getElementById("catalog-selected-count");
    if (el) el.textContent = `${selected.size} të zgjedhura`;
  }

  function renderCatalog() {
    const wrap = document.getElementById("catalog-categories");
    if (!wrap || !catalogData?.categories?.length) {
      if (wrap) wrap.innerHTML = '<p class="links-hint">Katalogu nuk u ngarkua.</p>';
      return;
    }

    wrap.innerHTML = catalogData.categories.map(cat => {
      const itemsHtml = cat.items.map(item => {
        const disabled = item.inMenu;
        const checked = selected.has(item.slug);
        const priceVal = selected.has(item.slug)
          ? selected.get(item.slug).price
          : item.defaultPrice;
        return `
          <label class="catalog-item${disabled ? " in-menu" : ""}${checked ? " selected" : ""}">
            <input type="checkbox" class="catalog-check" data-slug="${esc(item.slug)}"
              ${disabled ? "disabled" : ""} ${checked ? "checked" : ""}>
            <img class="catalog-item-photo" src="${esc(item.photoUrl)}" alt="" loading="lazy"
              onerror="this.classList.add('photo-fail'); this.src='';">
            <span class="catalog-item-name">${esc(item.name)}</span>
            ${disabled
              ? '<span class="catalog-in-menu-badge">Në menu</span>'
              : `<span class="catalog-item-price-wrap">
                  <input type="number" class="catalog-price" data-slug="${esc(item.slug)}"
                    min="0" step="0.01" value="${Number(priceVal).toFixed(2)}" ${checked ? "" : "disabled"}>
                  <span class="catalog-price-unit">€</span>
                </span>`}
          </label>`;
      }).join("");

      const avail = cat.items.filter(i => !i.inMenu).length;
      return `
        <section class="catalog-category" data-cat="${esc(cat.id)}">
          <div class="catalog-category-head">
            <h3>${esc(cat.name)}</h3>
            <span class="catalog-category-meta">${avail} të lira · ${cat.items.length} total</span>
            ${avail ? `<button type="button" class="btn btn-ghost btn-sm catalog-cat-all" data-cat="${esc(cat.id)}">Zgjidh kategorinë</button>` : ""}
          </div>
          <div class="catalog-items-grid">${itemsHtml}</div>
        </section>`;
    }).join("");

    bindCatalogEvents();
    updateSelectedCount();
  }

  function bindCatalogEvents() {
    const wrap = document.getElementById("catalog-categories");
    if (!wrap) return;

    wrap.querySelectorAll(".catalog-check").forEach(cb => {
      cb.addEventListener("change", () => {
        const slug = cb.dataset.slug;
        const item = findCatalogItem(slug);
        if (!item || item.inMenu) return;
        const label = cb.closest(".catalog-item");
        const priceInput = label?.querySelector(".catalog-price");
        if (cb.checked) {
          const price = Number(priceInput?.value) || item.defaultPrice;
          selected.set(slug, { slug, price });
          label?.classList.add("selected");
          if (priceInput) priceInput.disabled = false;
        } else {
          selected.delete(slug);
          label?.classList.remove("selected");
          if (priceInput) priceInput.disabled = true;
        }
        updateSelectedCount();
      });
    });

    wrap.querySelectorAll(".catalog-price").forEach(input => {
      input.addEventListener("input", () => {
        const slug = input.dataset.slug;
        if (!selected.has(slug)) return;
        selected.set(slug, { slug, price: Number(input.value) || 0 });
      });
    });

    wrap.querySelectorAll(".catalog-cat-all").forEach(btn => {
      btn.addEventListener("click", () => {
        const catId = btn.dataset.cat;
        const cat = catalogData.categories.find(c => c.id === catId);
        if (!cat) return;
        for (const item of cat.items) {
          if (item.inMenu) continue;
          selected.set(item.slug, { slug: item.slug, price: item.defaultPrice });
        }
        renderCatalog();
      });
    });
  }

  function findCatalogItem(slug) {
    for (const cat of catalogData?.categories || []) {
      const item = cat.items.find(i => i.slug === slug);
      if (item) return item;
    }
    return null;
  }

  async function loadOwnerCatalog() {
    setCatalogMsg("");
    const wrap = document.getElementById("catalog-categories");
    if (wrap) wrap.innerHTML = '<p class="links-hint">Duke ngarkuar…</p>';
    try {
      catalogData = await window.ownerApi("/api/owner/menu/catalog");
      selected.clear();
      renderCatalog();
    } catch (err) {
      setCatalogMsg(err.message, false);
      if (wrap) wrap.innerHTML = "";
    }
  }

  async function addSelectedToMenu() {
    if (!selected.size) {
      setCatalogMsg("Zgjidhni të paktën një artikull.", false);
      return;
    }
    const btn = document.getElementById("btn-catalog-add");
    if (btn) btn.disabled = true;
    setCatalogMsg("Duke shtuar artikujt dhe fotot…", true);
    try {
      const items = [...selected.values()];
      const res = await window.ownerApi("/api/owner/menu/from-catalog", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      selected.clear();
      let msg = `${res.count} artikuj u shtuan në menu.`;
      if (res.skipped?.length) {
        msg += ` ${res.skipped.length} ishin tashmë në menu.`;
      }
      setCatalogMsg(msg, true);
      await loadOwnerCatalog();
      if (typeof window.loadOwnerMenu === "function") {
        await window.loadOwnerMenu();
      }
    } catch (err) {
      setCatalogMsg(err.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById("btn-catalog-add")?.addEventListener("click", addSelectedToMenu);

  document.getElementById("btn-catalog-select-all")?.addEventListener("click", () => {
    if (!catalogData) return;
    for (const cat of catalogData.categories) {
      for (const item of cat.items) {
        if (!item.inMenu) {
          selected.set(item.slug, { slug: item.slug, price: item.defaultPrice });
        }
      }
    }
    renderCatalog();
  });

  document.getElementById("btn-catalog-clear")?.addEventListener("click", () => {
    selected.clear();
    renderCatalog();
  });

  window.loadOwnerCatalog = loadOwnerCatalog;
})();
