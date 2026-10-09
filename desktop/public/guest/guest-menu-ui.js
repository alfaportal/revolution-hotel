/** UI mysafir — i sinkronizuar me panelin (menu restoranti + shërbime hoteli). */
(function (global) {
  function guestApi(path) {
    const G = global.GuestOrder;
    if (G && typeof G.guestApi === "function") return G.guestApi(path);
    const p = String(path || "").trim();
    return p.startsWith("/") ? p : `/${p}`;
  }

  /** Foto menu — e njëjta burim si /api/menu (pronari/kamarieri). */
  function guestPhotoUrl(item) {
    const src = String(item?.photo_src || item?.photo || "").trim();
    if (src.startsWith("/") || /^https?:\/\//i.test(src)) return src;
    if (item?.id != null) return guestApi(`/api/guest/menu/${item.id}/photo`);
    return "";
  }

  /** Foto shërbimi — e njëjta burim si Admin → Shërbimet / kamarier. */
  function guestServicePhotoUrl(service, group) {
    const src = String(service?.photo_src || service?.photo || group?.photo || "").trim();
    if (src.startsWith("/") || /^https?:\/\//i.test(src)) return src;
    if (service?.id != null) return guestApi(`/api/guest/services/${service.id}/photo`);
    return "";
  }

  function photoImgHtml(url, alt, className) {
    const u = String(url || "").trim();
    if (!u) {
      return `<div class="menu-item-photo-wrap"><div class="menu-item-letter-ph">🍽️</div></div>`;
    }
    const cls = className || "menu-item-photo";
    return (
      `<div class="menu-item-photo-wrap">` +
      `<img class="${cls}" src="${u.replace(/"/g, "&quot;")}" alt="${String(alt || "").replace(/"/g, "&quot;")}" loading="lazy" decoding="async" ` +
      `onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'menu-item-letter-ph\\'>🍽️</div>';">` +
      `</div>`
    );
  }

  function orderedCategories(items, categoryOrder) {
    const present = new Set((items || []).map((i) => String(i.category || "").trim()).filter(Boolean));
    const ordered = (categoryOrder || []).filter((c) => present.has(c));
    for (const c of present) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }

  function bindCategoryBarScroll(bar) {
    if (!bar || bar.dataset.scrollBound === "1") return;
    bar.dataset.scrollBound = "1";
    bar.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        if (bar.scrollWidth <= bar.clientWidth + 1) return;
        e.preventDefault();
        bar.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    bar.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startLeft = bar.scrollLeft;
      bar.classList.add("is-dragging");
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      bar.scrollLeft = startLeft - (e.clientX - startX);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      bar.classList.remove("is-dragging");
      try {
        bar.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);
  }

  function renderGuestMenu({ barEl, gridEl, items, categories, onSelect, formatEuro }) {
    if (!gridEl) return;
    const fmt = typeof formatEuro === "function" ? formatEuro : (n) => Number(n || 0).toFixed(2) + " €";
    const list = Array.isArray(items) ? items.slice() : [];
    const cats = orderedCategories(list, categories);
    if (!cats.length) {
      if (barEl) barEl.innerHTML = "";
      gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka artikuj në menu restoranti.</p>';
      return;
    }

    let active = cats[0];
    global.menuPhotoUrl = guestPhotoUrl;

    function renderGrid() {
      const filtered = list
        .filter((it) => it.category === active)
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));

      gridEl.innerHTML = "";
      if (!filtered.length) {
        gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka artikuj për këtë kategori.</p>';
        return;
      }

      const grid = document.createElement("div");
      grid.className = "menu-photo-grid-inner menu-text-grid-inner";
      for (const it of filtered) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item-btn has-photo";
        const photo = guestPhotoUrl(it);
        btn.innerHTML =
          `<div class="menu-item-card has-photo">` +
          photoImgHtml(photo, it.name) +
          `<div class="menu-item-meta">` +
          `<span class="emri">${String(it.name || "").replace(/</g, "&lt;")}</span>` +
          `<span class="cmimi cmimi-badge">${fmt(it.price)}</span>` +
          `</div></div>`;
        btn.addEventListener("click", () => {
          onSelect?.(it, btn);
          global.MenuPosUI?.flashButton?.(btn);
        });
        grid.appendChild(btn);
      }
      gridEl.appendChild(grid);
    }

    function buildBar() {
      if (!barEl) return;
      barEl.innerHTML = "";
      for (const cat of cats) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-group-btn" + (cat === active ? " active" : "");
        btn.dataset.group = cat;
        btn.textContent = cat;
        btn.addEventListener("click", () => {
          active = cat;
          barEl.querySelectorAll(".menu-group-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.group === cat);
          });
          renderGrid();
          btn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
        });
        barEl.appendChild(btn);
      }
      bindCategoryBarScroll(barEl);
    }

    buildBar();
    renderGrid();
  }

  function renderGuestServices({ barEl, gridEl, groups, onAdd, priceLabel }) {
    if (!barEl || !gridEl) return;
    const gs = (groups || []).filter((g) => (g.services || []).length);
    if (!gs.length) {
      barEl.innerHTML = "";
      gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka shërbime hoteli — pronari i shton te Admin → Shërbimet.</p>';
      return;
    }

    let activeIdx = 0;

    function renderGrid() {
      const g = gs[activeIdx];
      const services = g?.services || [];
      gridEl.innerHTML = "";
      if (!services.length) {
        gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka shërbime për këtë kategori.</p>';
        return;
      }
      const grid = document.createElement("div");
      grid.className = "menu-photo-grid-inner menu-text-grid-inner";
      for (const s of services) {
        const card = document.createElement("div");
        card.className = "guest-svc-card";
        const photo = guestServicePhotoUrl(s, g);
        card.innerHTML =
          (photo
            ? `<img class="guest-svc-photo" src="${photo.replace(/"/g, "&quot;")}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="guest-svc-photo guest-svc-photo-ph">✨</div>`) +
          `<div class="guest-svc-name">${String(s.name || "").replace(/</g, "&lt;")}</div>` +
          `<div class="guest-svc-price">${String(priceLabel?.(s) || "").replace(/</g, "&lt;")}</div>` +
          `<button type="button" class="guest-svc-add">+ Shto</button>`;
        card.querySelector(".guest-svc-add")?.addEventListener("click", () => onAdd?.(s));
        grid.appendChild(card);
      }
      gridEl.appendChild(grid);
    }

    function buildBar() {
      barEl.innerHTML = "";
      gs.forEach((g, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-group-btn" + (idx === activeIdx ? " active" : "");
        btn.dataset.idx = String(idx);
        btn.textContent = g.name || "Të tjera";
        btn.addEventListener("click", () => {
          activeIdx = idx;
          barEl.querySelectorAll(".menu-group-btn").forEach((b) => {
            b.classList.toggle("active", Number(b.dataset.idx) === idx);
          });
          renderGrid();
          btn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
        });
        barEl.appendChild(btn);
      });
      bindCategoryBarScroll(barEl);
    }

    buildBar();
    renderGrid();
  }

  /**
   * Një faqe — Restorant (i pari) + kategoritë e shërbimeve hoteli; restoranti ka nën-taba kategori me foto.
   */
  function renderGuestHub({
    hubBarEl,
    subBarEl,
    gridEl,
    restaurantLabel = "Restorant",
    menuItems,
    menuCategories,
    serviceGroups,
    onMenuSelect,
    onServiceAdd,
    priceLabel,
    formatEuro,
  }) {
    if (!hubBarEl || !gridEl) return;
    const fmt = typeof formatEuro === "function" ? formatEuro : (n) => Number(n || 0).toFixed(2) + " €";
    const menuList = (Array.isArray(menuItems) ? menuItems : []).filter(
      (it) => String(it.category || "").trim().toLowerCase() !== "minibar",
    );
    const menuCats = orderedCategories(menuList, menuCategories).filter(
      (c) => String(c || "").trim().toLowerCase() !== "minibar",
    );
    const gs = (serviceGroups || []).filter((g) => (g.services || []).length);

    const tabs = [];
    if (menuList.length) {
      tabs.push({ kind: "restaurant", label: restaurantLabel, menuCats, menuList });
    }
    for (const g of gs) {
      tabs.push({ kind: "service", label: g.name || "Të tjera", group: g, services: g.services || [] });
    }
    if (!tabs.length) {
      hubBarEl.innerHTML = "";
      if (subBarEl) {
        subBarEl.hidden = true;
        subBarEl.innerHTML = "";
      }
      gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka menu ose shërbime — kontrolloni te pronari.</p>';
      return;
    }

    let activeTab = 0;
    let activeMenuCat = menuCats[0] || "";

    function renderServiceGrid(services, group) {
      gridEl.innerHTML = "";
      if (!services.length) {
        gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka shërbime për këtë kategori.</p>';
        return;
      }
      const grid = document.createElement("div");
      grid.className = "menu-photo-grid-inner menu-text-grid-inner";
      for (const s of services) {
        const card = document.createElement("div");
        card.className = "guest-svc-card";
        const photo = guestServicePhotoUrl(s, group);
        card.innerHTML =
          (photo
            ? `<img class="guest-svc-photo" src="${photo.replace(/"/g, "&quot;")}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="guest-svc-photo guest-svc-photo-ph">✨</div>`) +
          `<div class="guest-svc-name">${String(s.name || "").replace(/</g, "&lt;")}</div>` +
          `<div class="guest-svc-price">${String(priceLabel?.(s) || "").replace(/</g, "&lt;")}</div>` +
          `<button type="button" class="guest-svc-add">+ Shto</button>`;
        card.querySelector(".guest-svc-add")?.addEventListener("click", () => onServiceAdd?.(s));
        grid.appendChild(card);
      }
      gridEl.appendChild(grid);
    }

    function renderRestaurantGrid() {
      gridEl.innerHTML = "";
      const filtered = menuList
        .filter((it) => it.category === activeMenuCat)
        .sort(
          (a, b) =>
            (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
            || (Number(a.id) || 0) - (Number(b.id) || 0),
        );
      if (!filtered.length) {
        gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka artikuj për këtë kategori.</p>';
        return;
      }
      const grid = document.createElement("div");
      grid.className = "menu-photo-grid-inner menu-text-grid-inner";
      for (const it of filtered) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item-btn has-photo";
        const photo = guestPhotoUrl(it);
        btn.innerHTML =
          `<div class="menu-item-card has-photo">` +
          photoImgHtml(photo, it.name) +
          `<div class="menu-item-meta">` +
          `<span class="emri">${String(it.name || "").replace(/</g, "&lt;")}</span>` +
          `<span class="cmimi cmimi-badge">${fmt(it.price)}</span>` +
          `</div></div>`;
        btn.addEventListener("click", () => {
          onMenuSelect?.(it, btn);
          global.MenuPosUI?.flashButton?.(btn);
        });
        grid.appendChild(btn);
      }
      gridEl.appendChild(grid);
    }

    function buildMenuSubBar() {
      if (!subBarEl) return;
      if (tabs[activeTab]?.kind !== "restaurant" || !menuCats.length) {
        subBarEl.hidden = true;
        subBarEl.innerHTML = "";
        return;
      }
      subBarEl.hidden = false;
      subBarEl.innerHTML = "";
      for (const cat of menuCats) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-group-btn" + (cat === activeMenuCat ? " active" : "");
        btn.dataset.group = cat;
        btn.textContent = cat;
        btn.addEventListener("click", () => {
          activeMenuCat = cat;
          subBarEl.querySelectorAll(".menu-group-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.group === cat);
          });
          renderRestaurantGrid();
          btn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
        });
        subBarEl.appendChild(btn);
      }
      bindCategoryBarScroll(subBarEl);
    }

    function renderActive() {
      const tab = tabs[activeTab];
      if (!tab) return;
      if (tab.kind === "restaurant") {
        buildMenuSubBar();
        renderRestaurantGrid();
      } else {
        if (subBarEl) {
          subBarEl.hidden = true;
          subBarEl.innerHTML = "";
        }
        renderServiceGrid(tab.services, tab.group);
      }
    }

    hubBarEl.innerHTML = "";
    tabs.forEach((tab, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-group-btn" + (idx === activeTab ? " active" : "");
      btn.dataset.idx = String(idx);
      btn.textContent = tab.label;
      btn.addEventListener("click", () => {
        activeTab = idx;
        hubBarEl.querySelectorAll(".menu-group-btn").forEach((b) => {
          b.classList.toggle("active", Number(b.dataset.idx) === idx);
        });
        renderActive();
        btn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
      });
      hubBarEl.appendChild(btn);
    });
    bindCategoryBarScroll(hubBarEl);
    renderActive();
  }

  global.GuestMenuUI = {
    guestPhotoUrl,
    guestServicePhotoUrl,
    renderGuestMenu,
    renderGuestServices,
    renderGuestHub,
  };
})(window);
