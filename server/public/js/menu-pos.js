/** UI e menusë mobile — kamarier + QR tavolinë. Grid foto-first, kategori dinamike. */
(function (root) {
  function normCat(name) {
    return String(name || "").trim().toLowerCase();
  }

  function categoryMatchesGroup(category, group) {
    if (!group || group === "all") return true;
    if (group === "pije") return isDrinkCat(category);
    if (group === "ushqim") return !isDrinkCat(category);
    return normCat(category) === normCat(group);
  }

  function isDrinkCat(name) {
    var n = normCat(name);
    return n.startsWith("pije") || n.includes("alkool") || n.includes("alkoolike") || n.includes("birr");
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
    [/embelsir|dessert|akullore|ice\s*cream|tort|cake|krempit/, "🍰"],
    [/mish|steak|qebap|kebab|grill|zgar/, "🥩"],
    [/pule|chicken|nuggets/, "🍗"],
    [/peshk|fish|salmon/, "🐟"],
    [/omlet|veze|egg/, "🍳"],
    [/patate|fries|chips/, "🍟"],
    [/sushi/, "🍣"],
    [/taco|burrito|mex/, "🌮"],
  ];

  /** Emoji për secilën kategori (sipas emrit) */
  const CATEGORY_ICONS = {
    "pije të nxehta": "☕",
    "pije te nxehta": "☕",
    "pije të ftohta": "🥤",
    "pije te ftohta": "🥤",
    "birra": "🍺",
    "alkohole vera": "🍷",
    "alkohole & vera": "🍷",
    "ushqime": "🍔",
    "ushqim": "🍔",
    "ëmbëlsira": "🍰",
    "embelsira": "🍰",
    "snacks": "🍿",
    "tjera": "📦",
  };

  function categoryIcon(catName) {
    const n = normCat(catName);
    if (CATEGORY_ICONS[n]) return CATEGORY_ICONS[n];
    if (n.includes("pije") && n.includes("nxeht")) return "☕";
    if (n.includes("pije") && n.includes("ftoht")) return "🥤";
    if (n.includes("pije")) return "🥤";
    if (n.includes("birr")) return "🍺";
    if (n.includes("alkool") || n.includes("ver")) return "🍷";
    if (n.includes("ushqi")) return "🍔";
    if (n.includes("mbëlsir") || n.includes("mbelsir") || n.includes("dessert")) return "🍰";
    if (n.includes("snack")) return "🍿";
    return "📋";
  }

  function itemEmoji(item) {
    const name = normCat(item?.name);
    for (const [re, emoji] of EMOJI_RULES) {
      if (re.test(name)) return emoji;
    }
    return categoryIcon(item?.category) || "🍽️";
  }

  function itemHasPhoto(item) {
    return Boolean(item?.has_photo || String(item?.photo || "").trim() || item?.photo_url);
  }

  function defaultPhotoUrl(item) {
    if (item?.photo_url) return String(item.photo_url);
    if (!item?.id) return "";
    return `/api/menu/${item.id}/photo`;
  }

  function createPlaceholder(item, photoWrap) {
    const ph = document.createElement("span");
    ph.className = "menu-item-emoji-ph";
    ph.textContent = itemEmoji(item);
    ph.setAttribute("aria-hidden", "true");
    photoWrap.appendChild(ph);
  }

  function createMenuItemButton(item, { onSelect, disabled, formatEuro, getPhotoUrl, alwaysModal }) {
    const soldOut = Boolean(item.out_of_stock || item.sold_out);
    const photoUrl = (typeof getPhotoUrl === "function" ? getPhotoUrl(item) : "")
      || (itemHasPhoto(item) ? defaultPhotoUrl(item) : "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item-btn"
      + (soldOut ? " menu-item-sold-out-btn" : "")
      + (photoUrl ? " has-photo" : "");
    btn.disabled = !!disabled || soldOut;
    btn.setAttribute("aria-label", `${item.name}, ${formatEuro(item.price)}`);

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
        img.remove();
        wrap.innerHTML = "";
        createPlaceholder(item, wrap);
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

    const cmimi = document.createElement("span");
    cmimi.className = "cmimi-badge" + (Number(item.price) >= 5 ? " is-gold" : "");
    cmimi.textContent = soldOut ? (item.sold_out_label || "Mbaroi") : formatEuro(item.price);
    meta.appendChild(cmimi);

    card.appendChild(meta);
    btn.appendChild(card);

    if (soldOut) btn.classList.add("is-sold-out");
    if (!soldOut) {
      btn.addEventListener("click", () => {
        handleItemSelect(item, btn, {
          onSelect,
          formatEuro,
          getPhotoUrl,
          theme: "dark",
          alwaysModal: !!alwaysModal,
        });
      });
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
    if (!photo && item?.photo_url) photo = String(item.photo_url).trim();
    if (!photo && itemHasPhoto(item)) photo = defaultPhotoUrl(item);
    const priceTxt = typeof formatEuro === "function"
      ? formatEuro(item.price)
      : (Number(item.price || 0).toFixed(2) + " €");
    const root = document.createElement("div");
    root.id = "menu-item-detail-modal";
    root.className = "menu-item-detail-modal" + (theme === "light" ? "" : " is-dark");
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
    if (!opts.alwaysModal) {
      const desc = String(item?.description || "").trim();
      if (!desc) {
        opts.onSelect?.(item, btn);
        return;
      }
    }
    openItemDetailModal(item, {
      formatEuro: opts.formatEuro,
      getPhotoUrl: opts.getPhotoUrl,
      theme: opts.theme || "dark",
      onAdd: () => opts.onSelect?.(item, btn),
    });
  }

  function renderMenuGrid({
    container,
    menuItems,
    groupFilter,
    onSelectItem,
    disabled,
    formatEuro,
    getPhotoUrl,
    alwaysModal,
  }) {
    if (!container) return;
    container.innerHTML = "";

    const items = (menuItems || []).filter(i =>
      categoryMatchesGroup(i.category, groupFilter),
    );

    if (!items.length) {
      container.innerHTML = '<p class="menu-empty-msg">Nuk ka artikuj për këtë filtër</p>';
      return;
    }

    const grid = document.createElement("div");
    grid.className = "menu-photo-grid-inner";
    for (const it of items) {
      try {
        const btn = createMenuItemButton(it, {
          onSelect: onSelectItem,
          disabled,
          formatEuro,
          getPhotoUrl,
          alwaysModal,
        });
        if (btn) grid.appendChild(btn);
      } catch (err) {
        console.error("[menu-pos] render item:", err);
      }
    }
    container.appendChild(grid);
  }

  /**
   * Ndërto tab-bar dinamike nga lista e kategorive.
   * @param {HTMLElement} barEl - kontejneri ku shtohen tab-at
   * @param {string[]} categories - lista e kategorive nga bootstrap
   * @param {function} onChange - thirret me emrin e kategorisë kur klikohet
   * @param {string} [defaultCat] - kategoria fillestare
   */
  function buildCategoryTabs(barEl, categories, onChange, defaultCat) {
    if (!barEl) return;
    barEl.innerHTML = "";
    if (!categories || !categories.length) return;

    const wrap = document.createElement("div");
    wrap.className = "menu-cat-tabs";

    categories.forEach(cat => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-cat-tab";
      btn.dataset.category = cat;
      btn.textContent = cat;
      wrap.appendChild(btn);
    });

    barEl.appendChild(wrap);

    const buttons = [...wrap.querySelectorAll(".menu-cat-tab")];

    function activate(catName) {
      buttons.forEach(b => {
        b.classList.toggle("active", b.dataset.category === catName);
      });
      onChange(catName);
    }

    buttons.forEach(btn => {
      btn.addEventListener("click", () => activate(btn.dataset.category));
    });

    const initial = defaultCat && categories.includes(defaultCat)
      ? defaultCat
      : categories[0];
    activate(initial);
  }

  function isDrinkCategory(name) {
    const n = normCat(name);
    return n.startsWith("pije") || n.includes("alkool") || n.includes("alkoolike") || n.includes("birr");
  }

  function ensureGroupBarIcons(barEl) {
    if (!barEl) return;
    barEl.querySelectorAll(".menu-group-btn").forEach(btn => {
      const icon = btn.querySelector(".menu-tab-icon");
      if (icon) icon.remove();
      const label = btn.querySelector(".menu-tab-label");
      if (label) {
        btn.textContent = label.textContent.trim();
      } else {
        btn.textContent = String(btn.textContent || "")
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
          .trim() || (btn.dataset.group || "");
      }
    });
  }

  function bindGroupBar(barEl, onChange, opts) {
    if (!barEl) return;
    ensureGroupBarIcons(barEl);
    var defaultGroup = (opts && opts.defaultGroup) || "pije";
    var buttons = [].slice.call(barEl.querySelectorAll(".menu-group-btn"));
    function activate(group) {
      buttons.forEach(function(b) {
        b.classList.toggle("active", (b.dataset.group || "") === group);
      });
      onChange(group);
    }
    buttons.forEach(function(btn) {
      btn.addEventListener("click", function() { activate(btn.dataset.group || "pije"); });
    });
    var initial = buttons.some(function(b) { return b.dataset.group === defaultGroup; })
      ? defaultGroup
      : (buttons[0] && buttons[0].dataset.group || "pije");
    activate(initial);
  }

  root.MenuPosUI = {
    categoryMatchesGroup,
    categoryIcon,
    isDrinkCategory: isDrinkCat,
    itemEmoji,
    renderMenuGrid,
    renderMenuSections: renderMenuGrid,
    buildCategoryTabs,
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
})(typeof globalThis !== "undefined" ? globalThis : window);
