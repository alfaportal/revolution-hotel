/** UI mysafir — i sinkronizuar me panelin (menu restoranti + shërbime hoteli). */
(function (global) {
  /** Foto menu — e njëjta burim si /api/menu (pronari/kamarieri). */
  function guestPhotoUrl(item) {
    const src = String(item?.photo_src || item?.photo || "").trim();
    if (src.startsWith("/") || /^https?:\/\//i.test(src)) return src;
    if (item?.id != null) return `/api/guest/menu/${item.id}/photo`;
    return "";
  }

  /** Foto shërbimi — e njëjta burim si Admin → Shërbimet / kamarier. */
  function guestServicePhotoUrl(service, group) {
    const src = String(service?.photo_src || service?.photo || group?.photo || "").trim();
    if (src.startsWith("/") || /^https?:\/\//i.test(src)) return src;
    if (service?.id != null) return `/api/guest/services/${service.id}/photo`;
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
    if (!barEl || !gridEl) return;
    const fmt = typeof formatEuro === "function" ? formatEuro : (n) => Number(n || 0).toFixed(2) + " €";
    const list = Array.isArray(items) ? items.slice() : [];
    const cats = orderedCategories(list, categories);
    if (!cats.length) {
      barEl.innerHTML = "";
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
        const vatPct = Number(it.vat_percent ?? it.vat_rate ?? 18);
        const vatLetter = String(it.vat_letter || it.vat_norm || (vatPct === 8 ? "D" : vatPct === 0 ? "A" : "E"));
        btn.innerHTML =
          `<div class="menu-item-card has-photo">` +
          photoImgHtml(photo, it.name) +
          `<div class="menu-item-meta">` +
          `<span class="emri">${String(it.name || "").replace(/</g, "&lt;")}</span>` +
          `<span class="cmimi cmimi-badge">${fmt(it.price)}</span>` +
          `<span class="menu-item-vat-flag">${vatLetter} · ${vatPct}%</span>` +
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

  global.GuestMenuUI = {
    guestPhotoUrl,
    guestServicePhotoUrl,
    renderGuestMenu,
    renderGuestServices,
  };
})(window);
