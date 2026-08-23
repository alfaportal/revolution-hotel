/** UI profesionale për menu/shërbime mysafir — taba kategorish + grid (si restoranti). */
(function (global) {
  function guestPhotoUrl(item) {
    const src = String(item?.photo_src || item?.photo || "").trim();
    if (!src) return "";
    if (src.startsWith("/") || /^https?:\/\//i.test(src)) return src;
    return "";
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
    if (!barEl || !gridEl) return;
    const fmt = typeof formatEuro === "function" ? formatEuro : (n) => Number(n || 0).toFixed(2) + " €";
    const list = Array.isArray(items) ? items.slice() : [];
    const cats = orderedCategories(list, categories);
    if (!cats.length) {
      barEl.innerHTML = "";
      gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka artikuj.</p>';
      return;
    }

    let active = cats[0];
    global.menuPhotoUrl = guestPhotoUrl;

    function renderGrid() {
      const filtered = list
        .filter((it) => it.category === active)
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));

      if (global.MenuPosUI && typeof global.MenuPosUI.renderMenuGrid === "function") {
        global.MenuPosUI.renderMenuGrid({
          container: gridEl,
          menuItems: filtered,
          groupFilter: active,
          onSelectItem: (item, btn) => {
            onSelect?.(item, btn);
            global.MenuPosUI.flashButton?.(btn);
          },
          formatEuro: fmt,
        });
        return;
      }

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
        btn.className = "menu-item-btn";
        const photo = guestPhotoUrl(it);
        btn.innerHTML =
          `<div class="menu-item-card${photo ? " has-photo" : ""}">` +
          (photo
            ? `<div class="menu-item-photo-wrap"><img class="menu-item-photo" src="${photo.replace(/"/g, "&quot;")}" alt="" loading="lazy"></div>`
            : `<div class="menu-item-photo-wrap"><div class="menu-item-letter-ph">🍽️</div></div>`) +
          `<div class="menu-item-meta"><span class="emri">${String(it.name || "").replace(/</g, "&lt;")}</span>` +
          `<span class="cmimi cmimi-badge">${fmt(it.price)}</span></div></div>`;
        btn.addEventListener("click", () => onSelect?.(it, btn));
        grid.appendChild(btn);
      }
      gridEl.appendChild(grid);
    }

    function buildBar() {
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
      gridEl.innerHTML = '<p class="menu-empty-msg">Nuk ka shërbime.</p>';
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
        const photo = String(s.photo || g.photo || "").trim();
        card.innerHTML =
          (photo ? `<img class="guest-svc-photo" src="${photo.replace(/"/g, "&quot;")}" alt="" loading="lazy">` : "") +
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

  global.GuestMenuUI = {
    guestPhotoUrl,
    renderGuestMenu,
    renderGuestServices,
  };
})(window);
