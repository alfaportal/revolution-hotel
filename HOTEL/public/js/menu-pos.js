/** UI e menusë POS — kartela profesionale, Pije / Ushqim, tap = shto në porosi. */
(function (global) {
  function normCat(name) {
    return String(name || "").trim().toLowerCase();
  }

  function isDrinkCategory(name) {
    const n = normCat(name);
    return n.startsWith("pije") || n.includes("alkool") || n.includes("alkoolike");
  }

  function categoryMatchesGroup(category, group) {
    if (!group) return true;
    if (group === "pije") return isDrinkCategory(category);
    if (group === "ushqim") return !isDrinkCategory(category);
    return String(category || "").trim() === String(group || "").trim();
  }

  const EMOJI_RULES = [
    [/coca|cola|pepsi|fanta|sprite|schweppes|mirinda/, "🥤"],
    [/red\s*bull|monster|energj/i, "⚡"],
    [/kafe|espresso|cappuccino|latte|macchiato|moka|americano/, "☕"],
    [/çaj|caj|tea|ice\s*tea|icetea/, "🍵"],
    [/ujë|uje|water|mineral/, "💧"],
    [/lëng|leng|juice|smoothie|frut/, "🧃"],
    [/birr|beer|ver[eë]|wine|whisk|rak[ij]|alkool|cocktail|mojito|spritz/, "🍺"],
    [/pizza/, "🍕"],
    [/burger|hamburger/, "🍔"],
    [/sandwich|toast|bagel/, "🥪"],
    [/pasta|spaghetti|lasagn|makaron/, "🍝"],
    [/salat|salad/, "🥗"],
    [/sup[eë]|soup|corb/, "🍲"],
    [/embelsir|dessert|akullore|ice\s*cream|tort|cake|krempit|ëmbël|embels/, "🍰"],
    [/mish|steak|qebap|kebab|grill|zgar/, "🥩"],
    [/pule|chicken|nuggets/, "🍗"],
    [/peshk|fish|salmon/, "🐟"],
    [/omlet|veze|egg/, "🍳"],
    [/patate|fries|chips|snack/, "🍟"],
    [/sushi/, "🍣"],
    [/taco|burrito|mex/, "🌮"],
  ];

  function itemEmoji(item) {
    const name = normCat(item?.name);
    for (const [re, emoji] of EMOJI_RULES) {
      if (re.test(name)) return emoji;
    }
    if (isDrinkCategory(item?.category)) return "🥤";
    return "🍽️";
  }

  /** Gjendja e stokut për një artikull — vetëm nëse pronari ka vendosur prag > 0. */
  function stockState(item) {
    const threshold = Number(item?.low_stock_threshold) || 0;
    if (threshold <= 0) return null;
    const qty = Number(item?.stock_qty) || 0;
    if (qty <= 0) return "out";
    if (qty <= threshold) return "low";
    return null;
  }

  function createMenuItemButton(item, { onSelect, disabled, formatEuro }) {
    const stock = stockState(item);
    const outOfStock = stock === "out";
    const photoUrl = typeof menuPhotoUrl === "function" ? menuPhotoUrl(item) : "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item-btn menu-item-text-btn"
      + (stock ? ` menu-item-stock-${stock}` : "")
      + (photoUrl ? " has-photo" : "");
    btn.disabled = !!disabled || outOfStock;

    const card = document.createElement("div");
    card.className = "menu-item-card" + (photoUrl ? " has-photo" : "");

    if (photoUrl) {
      const wrap = document.createElement("div");
      wrap.className = "menu-item-photo-wrap";
      const img = document.createElement("img");
      img.className = "menu-item-photo";
      img.src = photoUrl;
      img.alt = item.name || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = () => {
        wrap.remove();
        card.classList.remove("has-photo");
        btn.classList.remove("has-photo");
      };
      wrap.appendChild(img);
      card.appendChild(wrap);
    }

    const meta = document.createElement("div");
    meta.className = "menu-item-meta";

    const emri = document.createElement("span");
    emri.className = "emri";
    emri.textContent = item.name;
    meta.appendChild(emri);

    if (stock) {
      const flag = document.createElement("span");
      flag.className = "menu-item-stock-flag menu-item-stock-flag-" + stock;
      flag.textContent = outOfStock ? "⛔ Pa stok" : "⚠ Stok i ulët";
      meta.appendChild(flag);
    }

    const cmimi = document.createElement("span");
    cmimi.className = "cmimi cmimi-badge" + (Number(item.price) >= 5 ? " is-gold" : "");
    cmimi.textContent = formatEuro(item.price);
    meta.appendChild(cmimi);

    const vatPct = Number(item.vat_percent ?? item.vat_rate ?? item.vat_category ?? 18);
    const vatLetter = String(item.vat_letter || item.vat_norm || (vatPct === 8 ? "D" : vatPct === 0 ? "A" : "E"));
    const vat = document.createElement("span");
    vat.className = "menu-item-vat-flag";
    vat.textContent = `${vatLetter} · ${vatPct}%`;
    vat.title = `TVSH ${vatLetter} = ${vatPct}%`;
    meta.appendChild(vat);

    card.appendChild(meta);
    btn.appendChild(card);
    if (!outOfStock) {
      btn.addEventListener("click", () => onSelect(item, btn));
    }
    return btn;
  }

  function escModal(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function closeItemDetailModal() {
    document.getElementById("menu-item-detail-modal")?.remove();
  }

  function openItemDetailModal(item, { formatEuro, getPhotoUrl, onAdd, theme } = {}) {
    closeItemDetailModal();
    const desc = String(item?.description || "").trim();
    let photo = "";
    if (typeof getPhotoUrl === "function") photo = String(getPhotoUrl(item) || "").trim();
    else if (typeof menuPhotoUrl === "function") photo = String(menuPhotoUrl(item) || "").trim();
    const priceTxt = typeof formatEuro === "function"
      ? formatEuro(item.price)
      : (Number(item.price || 0).toFixed(2) + " €");
    const root = document.createElement("div");
    root.id = "menu-item-detail-modal";
    root.className = "menu-item-detail-modal" + (theme === "dark" ? " is-dark" : "");
    root.innerHTML = `
      <div class="menu-item-detail-backdrop" data-close="1"></div>
      <div class="menu-item-detail-card" role="dialog" aria-modal="true">
        <button type="button" class="menu-item-detail-close" data-close="1" aria-label="Mbyll">×</button>
        ${photo ? `<div class="menu-item-detail-photo"><img src="${escModal(photo)}" alt=""></div>` : ""}
        <h3 class="menu-item-detail-name">${escModal(item.name)}</h3>
        <div class="menu-item-detail-price">${escModal(priceTxt)}</div>
        ${desc ? `<p class="menu-item-detail-desc">${escModal(desc)}</p>` : ""}
        <button type="button" class="menu-item-detail-add">Shto në porosi</button>
      </div>`;
    document.body.appendChild(root);
    const close = () => closeItemDetailModal();
    root.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", close));
    root.querySelector(".menu-item-detail-add")?.addEventListener("click", () => {
      close();
      onAdd?.(item);
    });
  }

  function handleItemSelect(item, btn, opts = {}) {
    if (opts.alwaysModal) {
      openItemDetailModal(item, {
        formatEuro: opts.formatEuro,
        getPhotoUrl: opts.getPhotoUrl,
        theme: opts.theme || "light",
        onAdd: () => opts.onSelect?.(item, btn),
      });
      return;
    }
    opts.onSelect?.(item, btn);
  }

  function renderMenuGrid({
    container,
    menuItems,
    groupFilter,
    onSelectItem,
    disabled,
    formatEuro,
  }) {
    if (!container) return;
    container.innerHTML = "";

    /* Si telefon/QR/takeaway: id (seed), jo alfabet nga SQL. */
    const items = (menuItems || [])
      .filter(i => categoryMatchesGroup(i.category, groupFilter))
      .slice()
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

    if (!items.length) {
      container.innerHTML =
        '<p class="menu-empty-msg">Nuk ka artikuj për këtë filtër</p>';
      return;
    }

    const grid = document.createElement("div");
    grid.className = "menu-photo-grid-inner menu-text-grid-inner";
    const forceAll = renderMenuGrid._forceAll;
    const toRender = (!forceAll && items.length > 100) ? items.slice(0, 60) : items;
    for (const it of toRender) {
      grid.appendChild(createMenuItemButton(it, {
        onSelect: onSelectItem,
        disabled,
        formatEuro,
      }));
    }
    if (!forceAll && items.length > 100) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn btn-ghost";
      more.style.cssText = "grid-column:1/-1";
      more.textContent = `Shfaq të gjitha (${items.length})`;
      more.addEventListener("click", () => {
        renderMenuGrid._forceAll = true;
        renderMenuGrid({
          container,
          menuItems,
          groupFilter,
          onSelectItem,
          disabled,
          formatEuro,
        });
      });
      grid.appendChild(more);
    }
    container.appendChild(grid);
  }

  function bindGroupBar(barEl, onChange, { defaultGroup = "pije" } = {}) {
    if (!barEl) return;
    const buttons = [...barEl.querySelectorAll(".menu-group-btn")];

    function activate(group) {
      buttons.forEach(b => {
        b.classList.toggle("active", (b.dataset.group || "") === group);
      });
      onChange(group);
    }

    buttons.forEach(btn => {
      btn.addEventListener("click", () => activate(btn.dataset.group || "pije"));
    });

    const initial = buttons.some(b => b.dataset.group === defaultGroup)
      ? defaultGroup
      : (buttons[0]?.dataset.group || "pije");
    activate(initial);
  }

  global.MenuPosUI = {
    categoryMatchesGroup,
    isDrinkCategory,
    itemEmoji,
    renderMenuGrid,
    renderMenuSections: renderMenuGrid,
    bindGroupBar,
    openItemDetailModal,
    handleItemSelect,
    closeItemDetailModal,
    flashButton(btn) {
      if (!btn) return;
      btn.classList.add("menu-item-flash");
      setTimeout(() => btn.classList.remove("menu-item-flash"), 400);
    },
  };
})(window);
