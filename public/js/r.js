(function () {
  const PWA_KEY = "ri_restaurant_pwa_dismissed";
  let deferredPrompt = null;
  let pageData = null;

  function getSlug() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] === "r" || parts[0] === "furra" || parts[0] === "hotel"
      ? decodeURIComponent(parts[1] || "")
      : "";
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(el => {
      const on = el.id === id;
      el.classList.toggle("active", on);
      el.classList.toggle("hidden", !on);
    });
  }

  function euro(n) {
    const num = Number(n);
    return (Number.isFinite(num) ? num : 0).toFixed(2) + " €";
  }

  function safeCall(label, fn) {
    try {
      return fn();
    } catch (err) {
      console.error(`[public-page] ${label}:`, err);
      return undefined;
    }
  }

  function friendlyError(err) {
    const msg = String(err?.message || err || "").trim();
    if (!msg || /is not defined|cannot read propert|undefined|null|syntax/i.test(msg)) {
      return "Faqja nuk u ngarkua. Rifreskoni faqen ose provoni përsëri pas pak.";
    }
    return msg;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch {
      return String(value || "");
    }
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function initPwaBanner() {
    const banner = document.getElementById("pwa-banner");
    const hint = document.getElementById("pwa-hint");
    const closeBtn = document.getElementById("pwa-close");
    const installBtn = document.getElementById("pwa-install-btn");
    if (!banner || !hint) return;

    if (isStandalone() || localStorage.getItem(PWA_KEY) === "1") return;

    hint.textContent = isIos()
      ? "Kliko Share (□↑) → Add to Home Screen për akses të shpejtë."
      : "Instalo aplikacionin e restorantit në telefonin tuaj.";

    banner.classList.remove("hidden");
    document.body.classList.add("pwa-banner-visible");

    closeBtn?.addEventListener("click", () => {
      localStorage.setItem(PWA_KEY, "1");
      banner.classList.add("hidden");
      document.body.classList.remove("pwa-banner-visible");
    });

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) {
        installBtn.classList.remove("hidden");
        installBtn.addEventListener("click", async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          banner.classList.add("hidden");
          document.body.classList.remove("pwa-banner-visible");
        });
      }
    });
  }

  function registerSw(slug) {
    if (!("serviceWorker" in navigator) || !slug) return;
    const enc = encodeURIComponent(slug);
    navigator.serviceWorker.register(`/r/${enc}/sw.js`, { scope: `/r/${enc}/` }).catch(() => {});
  }

  function applyTheme(color) {
    if (!color) return;
    document.documentElement.style.setProperty("--accent", color);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", color);
  }

  function renderHours(hoursDisplay) {
    const list = document.getElementById("hours-list");
    if (!list) return;
    list.innerHTML = (hoursDisplay || []).map(row => `
      <li>
        <span class="day">${escapeHtml(row.label)}</span>
        <span class="time">${escapeHtml(row.text)}</span>
      </li>
    `).join("");
  }

  const ITEM_EMOJI = [
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
    [/patate|fries|chips/, "🍟"],
    [/sushi/, "🍣"],
    [/taco|burrito|mex/, "🌮"],
  ];

  const CATEGORY_EMOJI = [
    [/nxeht|kafe|çaj|caj|coffee|tea/, "☕"],
    [/ftoht|pije|drink|beverage/, "🥤"],
    [/ëmbël|embels|dessert|akullore|cake/, "🍰"],
    [/snack|chips|perime/, "🍿"],
    [/alkool|birra|wine|ver[eë]/, "🍺"],
    [/pizza/, "🍕"],
    [/burger|sandwich/, "🍔"],
    [/salat|salad/, "🥗"],
    [/mish|grill|qebap|steak/, "🥩"],
    [/pasta|makaron/, "🍝"],
    [/ushqim|pjat|main/, "🍽️"],
  ];

  function categoryEmoji(name) {
    const n = String(name || "").trim().toLowerCase();
    for (const [re, emoji] of CATEGORY_EMOJI) {
      if (re.test(n)) return emoji;
    }
    return "📋";
  }

  function menuItemEmoji(item) {
    const name = String(item?.name || "").trim().toLowerCase();
    for (const [re, emoji] of ITEM_EMOJI) {
      if (re.test(name)) return emoji;
    }
    return categoryEmoji(item?.category) || "🍽️";
  }

  let activeMenuCategory = "";
  let pageOrderUrl = "";

  function queueOrderItem(item) {
    try {
      sessionStorage.setItem("r_pending_item", JSON.stringify({
        name: item.name,
        price: Number(item.price) || 0,
      }));
    } catch { /* private mode */ }
  }

  function goToOrderWithItem(item) {
    queueOrderItem(item);
    if (pageOrderUrl) {
      window.location.assign(pageOrderUrl);
      return;
    }
    const hero = document.getElementById("hero-order-btn");
    if (hero?.href) window.location.assign(hero.href);
  }

  function onPublicMenuItemClick(item) {
    const add = () => goToOrderWithItem(item);
    try {
      if (window.MenuPosUI?.openItemDetailModal) {
        MenuPosUI.openItemDetailModal(item, {
          formatEuro: euro,
          getPhotoUrl: it => String(it.photo_url || "").trim(),
          theme: "dark",
          onAdd: add,
        });
        return;
      }
      if (window.MenuPosUI?.handleItemSelect) {
        MenuPosUI.handleItemSelect(item, null, {
          onSelect: add,
          formatEuro: euro,
          getPhotoUrl: it => String(it.photo_url || "").trim(),
          theme: "dark",
          alwaysModal: true,
        });
        return;
      }
    } catch (err) {
      console.error("[public-page] product-modal:", err);
    }
    add();
  }

  function renderMenuCards(menu, category) {
    const wrap = document.getElementById("menu-sections");
    if (!wrap) return;

    const items = (menu || []).filter(i => i && i.category === category && i.name);
    if (!items.length) {
      wrap.innerHTML = '<p class="pub-menu-empty">Nuk ka artikuj në këtë kategori.</p>';
      return;
    }

    wrap.innerHTML = `<div class="pub-menu-grid">${items.map((it, idx) => {
      try {
        const price = Number(it.price);
        const safePrice = Number.isFinite(price) ? price : 0;
        const gold = safePrice >= 5;
        const photoUrl = String(it.photo_url || "").trim();
        const media = photoUrl
          ? `<div class="pub-menu-media"><img src="${escapeAttr(photoUrl)}" alt="" loading="lazy" width="120" height="120"></div>`
          : `<div class="pub-menu-media pub-menu-emoji" aria-hidden="true">${menuItemEmoji(it)}</div>`;
        return `
          <button type="button" class="pub-menu-card" data-idx="${idx}" aria-label="${escapeAttr(it.name)}">
            ${media}
            <div class="pub-menu-body">
              <h3 class="pub-menu-name">${escapeHtml(it.name)}</h3>
              <span class="pub-menu-price${gold ? " is-gold" : ""}">${euro(safePrice)}</span>
            </div>
          </button>`;
      } catch {
        return "";
      }
    }).filter(Boolean).join("")}</div>`;

    wrap.querySelectorAll(".pub-menu-card img").forEach(img => {
      img.addEventListener("error", () => {
        const media = img.closest(".pub-menu-media");
        if (!media) return;
        const name = img.closest(".pub-menu-card")?.getAttribute("aria-label") || "";
        media.className = "pub-menu-media pub-menu-emoji";
        media.setAttribute("aria-hidden", "true");
        media.textContent = menuItemEmoji({ name });
      }, { once: true });
    });

    wrap.querySelectorAll(".pub-menu-card").forEach(card => {
      card.addEventListener("click", () => {
        const idx = Number(card.dataset.idx);
        const item = items[idx];
        if (item) onPublicMenuItemClick(item);
      });
    });
    observeReveal(wrap.querySelectorAll(".pub-menu-card"));
  }

  function updateCatNavIndicator(activeBtn) {
    const indicator = document.getElementById("cat-nav-indicator");
    const nav = document.getElementById("cat-nav");
    if (!indicator || !nav || !activeBtn) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    indicator.style.width = `${btnRect.width}px`;
    indicator.style.transform = `translateX(${btnRect.left - navRect.left + nav.scrollLeft}px)`;
  }

  /** Si QR/panel: id (local_id) — Espresso… pastaj Çaj, jo alfabet locale. */
  function menuSortedLikePanel(menu) {
    return (menu || []).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  }

  function renderMenu(categories, menu) {
    const nav = document.getElementById("cat-nav");
    const wrap = document.getElementById("menu-sections");
    if (!nav || !wrap) return;

    const list = menuSortedLikePanel(Array.isArray(menu) ? menu : []);
    const cats = categories?.length
      ? categories.filter(Boolean)
      : [...new Set(list.map(i => i?.category).filter(Boolean))];

    if (!cats.length) {
      nav.innerHTML = "";
      wrap.innerHTML = '<p class="pub-menu-empty">Menuja do të publikohet së shpejti.</p>';
      return;
    }

    if (!activeMenuCategory || !cats.includes(activeMenuCategory)) {
      activeMenuCategory = cats[0];
    }

    nav.innerHTML = cats.map(cat => {
      const enc = encodeURIComponent(cat);
      const active = cat === activeMenuCategory ? " active" : "";
      return `<button type="button" data-cat="${enc}" class="cat-tab${active}">${escapeHtml(cat)}</button>`;
    }).join("");

    renderMenuCards(list, activeMenuCategory);

    const buttons = [...nav.querySelectorAll(".cat-tab")];
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        activeMenuCategory = safeDecode(btn.dataset.cat);
        if (!cats.includes(activeMenuCategory)) activeMenuCategory = cats[0];
        buttons.forEach(b => b.classList.toggle("active", b === btn));
        renderMenuCards(list, activeMenuCategory);
        updateCatNavIndicator(btn);
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
    });

    const activeBtn = nav.querySelector(".cat-tab.active") || buttons[0];
    requestAnimationFrame(() => safeCall("cat-nav-indicator", () => updateCatNavIndicator(activeBtn)));
    if (!nav.dataset.indicatorBound) {
      nav.dataset.indicatorBound = "1";
      nav.addEventListener("scroll", () => {
        safeCall("cat-nav-indicator-scroll", () => {
          updateCatNavIndicator(nav.querySelector(".cat-tab.active"));
        });
      }, { passive: true });
    }
  }

  function escapeAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
  }

  function renderStars(count) {
    const n = Math.max(1, Math.min(5, Number(count) || 0));
    return "★".repeat(n) + "☆".repeat(5 - n);
  }

  function renderDailyOffer(text) {
    const banner = document.getElementById("daily-offer-banner");
    const el = document.getElementById("daily-offer-text");
    const t = String(text || "").trim();
    if (!banner || !el || !t) {
      banner?.classList.add("hidden");
      return;
    }
    el.textContent = t;
    banner.classList.remove("hidden");
  }

  function renderGallery(urls) {
    const section = document.getElementById("gallery-section");
    const grid = document.getElementById("gallery-grid");
    const list = (urls || []).filter(Boolean);
    if (!section || !grid || !list.length) {
      section?.classList.add("hidden");
      if (grid) grid.innerHTML = "";
      return;
    }
    grid.innerHTML = list.map((url, idx) => `
      <button type="button" class="gallery-item" data-photo="${escapeAttr(url)}" data-name="Galeria ${idx + 1}" aria-label="Shiko foton ${idx + 1}">
        <img src="${escapeAttr(url)}" alt="Foto ${idx + 1}" loading="lazy">
      </button>
    `).join("");
    section.classList.remove("hidden");
    grid.querySelectorAll(".gallery-item").forEach(btn => {
      btn.addEventListener("click", () => openPhotoLightbox(btn.dataset.photo, btn.dataset.name));
    });
  }

  function renderReviews(reviews) {
    const section = document.getElementById("reviews-section");
    const listEl = document.getElementById("reviews-list");
    const rows = (reviews || []).filter(r => r?.name);
    if (!section || !listEl || !rows.length) {
      section?.classList.add("hidden");
      if (listEl) listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = rows.map(r => `
      <article class="review-card">
        <div class="review-stars" aria-label="${r.stars} yje">${renderStars(r.stars)}</div>
        <div class="review-name">${escapeHtml(r.name)}</div>
        ${r.text ? `<p class="review-text">${escapeHtml(r.text)}</p>` : ""}
      </article>
    `).join("");
    section.classList.remove("hidden");
  }

  function renderContactActions(data) {
    const wrap = document.getElementById("contact-actions");
    const waBtn = document.getElementById("btn-whatsapp");
    const socialEl = document.getElementById("social-links");
    if (!wrap) return;

    let any = false;

    if (waBtn) {
      const wa = String(data?.whatsapp_url || "").trim();
      if (wa) {
        waBtn.href = wa;
        waBtn.classList.remove("hidden");
        waBtn.onclick = (e) => {
          e.preventDefault();
          openExternalUrl(wa);
        };
        any = true;
      } else {
        waBtn.classList.add("hidden");
      }
    }

    if (socialEl) {
      const social = data?.social || {};
      const items = [];
      if (social.instagram) {
        items.push({ label: "Instagram", url: social.instagram, icon: "📷" });
      }
      if (social.facebook) {
        items.push({ label: "Facebook", url: social.facebook, icon: "👍" });
      }
      if (social.tiktok) {
        items.push({ label: "TikTok", url: social.tiktok, icon: "🎵" });
      }
      if (items.length) {
        socialEl.innerHTML = items.map(it => `
          <a class="social-link" href="${escapeAttr(it.url)}" target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">${it.icon}</span>${escapeHtml(it.label)}
          </a>
        `).join("");
        socialEl.classList.remove("hidden");
        any = true;
      } else {
        socialEl.innerHTML = "";
        socialEl.classList.add("hidden");
      }
    }

    wrap.classList.toggle("hidden", !any);
  }

  function openPhotoLightbox(url, name) {
    const box = document.getElementById("menu-photo-lightbox");
    const img = document.getElementById("menu-photo-lightbox-img");
    const caption = document.getElementById("menu-photo-lightbox-caption");
    if (!box || !img || !url) return;
    img.src = url;
    img.alt = name || "";
    if (caption) caption.textContent = name || "";
    box.classList.remove("hidden");
    document.body.classList.add("menu-lightbox-open");
  }

  function bindMenuPhotoLightbox() {
    const box = document.getElementById("menu-photo-lightbox");
    const img = document.getElementById("menu-photo-lightbox-img");
    const caption = document.getElementById("menu-photo-lightbox-caption");
    const closeBtn = document.getElementById("menu-photo-close");
    if (!box || !img) return;

    const close = () => {
      box.classList.add("hidden");
      img.removeAttribute("src");
      if (caption) caption.textContent = "";
      document.body.classList.remove("menu-lightbox-open");
    };

    document.querySelectorAll(".menu-item-photo-btn, .pub-menu-photo-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        openPhotoLightbox(btn.getAttribute("data-photo") || "", btn.getAttribute("data-name") || "");
      });
    });

    closeBtn?.addEventListener("click", close);
    box.addEventListener("click", (e) => {
      if (e.target === box) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !box.classList.contains("hidden")) close();
    });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function googleMapsUrl(address) {
    const query = String(address || "").trim();
    if (!query) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function openExternalUrl(url) {
    if (!url) return;
    if (isStandalone()) {
      window.location.assign(url);
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(url);
  }

  /** Upgrade legacy cached markup to the current address card layout. */
  function ensureAddressCard() {
    let card = document.getElementById("info-address");
    if (!card) return null;

    if (card.tagName === "A") {
      const address = card.querySelector("#val-address")?.textContent?.trim()
        || card.textContent.replace(/Hap në Google Maps/gi, "").trim();
      const div = document.createElement("div");
      div.id = "info-address";
      div.className = "info-card";
      div.hidden = card.hidden;
      div.innerHTML = `
        <span class="info-icon" aria-hidden="true">📍</span>
        <div class="info-address-body">
          <div class="info-label">Adresa</div>
          <div class="info-value" id="val-address"></div>
          <a class="maps-btn" id="btn-maps-address" href="#" target="_blank" rel="noopener noreferrer">
            <span class="maps-btn-icon" aria-hidden="true">🗺️</span>
            Hap në Google Maps
          </a>
        </div>`;
      card.replaceWith(div);
      card = div;
      const textEl = document.getElementById("val-address");
      if (textEl && address) textEl.textContent = address;
    }

    if (!document.getElementById("btn-maps-address")) {
      const body = card.querySelector(".info-address-body") || card.querySelector("div");
      if (body) {
        const btn = document.createElement("a");
        btn.id = "btn-maps-address";
        btn.className = "maps-btn";
        btn.href = "#";
        btn.target = "_blank";
        btn.rel = "noopener noreferrer";
        btn.innerHTML = '<span class="maps-btn-icon" aria-hidden="true">🗺️</span> Hap në Google Maps';
        body.appendChild(btn);
      }
    }

    return card;
  }

  function bindMapsButton(btn, mapsUrl, label) {
    if (!btn || !mapsUrl) return;
    btn.href = mapsUrl;
    btn.setAttribute("aria-label", label || "Hap në Google Maps");
    btn.onclick = (e) => {
      e.preventDefault();
      openExternalUrl(mapsUrl);
    };
  }

  function renderAddress(data) {
    const address = String(data?.address || "").trim();
    if (!address) return;

    const mapsUrl = String(data?.maps_url || "").trim() || googleMapsUrl(address);
    if (!mapsUrl) return;

    const card = ensureAddressCard();
    if (!card) return;

    card.hidden = false;
    const textEl = document.getElementById("val-address");
    if (textEl) textEl.textContent = address;

    bindMapsButton(
      document.getElementById("btn-maps-address"),
      mapsUrl,
      `Hap ${address} në Google Maps`,
    );
  }

  function observeReveal(nodes) {
    if (!nodes?.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver !== "function") {
      nodes.forEach(el => el.classList.add("is-visible"));
      return;
    }
    try {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
      nodes.forEach((el, i) => {
        el.style.transitionDelay = `${Math.min(i, 8) * 45}ms`;
        io.observe(el);
      });
    } catch {
      nodes.forEach(el => el.classList.add("is-visible"));
    }
  }

  function initScrollReveal() {
    observeReveal(document.querySelectorAll(".reveal"));
  }

  function bindOrderLinks(orderUrl) {
    pageOrderUrl = String(orderUrl || "").trim();
    const orderBar = document.getElementById("order-bar");
    const orderBtn = document.getElementById("btn-order");
    const heroBtn = document.getElementById("hero-order-btn");
    if (!orderBar || !orderBtn) return;

    if (pageOrderUrl) {
      orderBtn.href = pageOrderUrl;
      orderBar.hidden = false;
      if (heroBtn) {
        heroBtn.href = pageOrderUrl;
        heroBtn.classList.remove("hidden");
      }
    } else {
      orderBtn.removeAttribute("href");
      orderBar.hidden = true;
      heroBtn?.classList.add("hidden");
    }
  }

  function renderPage(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Të dhënat e faqes mungojnë");
    }

    pageData = data;
    document.title = data.name || "Restorant";
    const appleIcon = document.getElementById("apple-icon");
    if (appleIcon && data.logo_url) appleIcon.href = data.logo_url;

    applyTheme(data.theme_color);

    const bizName = document.getElementById("biz-name");
    if (bizName) bizName.textContent = data.name || "Restorant";

    const hero = document.getElementById("hero");
    const coverImg = document.getElementById("hero-cover");
    if (coverImg && data.cover_url) {
      coverImg.src = data.cover_url;
      coverImg.alt = data.name || "Cover";
      coverImg.classList.remove("hidden");
      hero?.classList.add("has-cover");
    } else {
      coverImg?.classList.add("hidden");
      hero?.classList.remove("has-cover");
    }

    const descEl = document.getElementById("biz-desc");
    if (descEl) {
      if (data.description) {
        descEl.textContent = data.description;
        descEl.hidden = false;
      } else {
        descEl.textContent = "";
        descEl.hidden = true;
      }
    }

    const logoWrap = document.getElementById("hero-logo-wrap");
    const logoImg = document.getElementById("hero-logo");
    if (logoWrap && logoImg) {
      if (data.logo_url) {
        logoImg.src = data.logo_url;
        logoImg.alt = data.name || "";
        logoWrap.hidden = false;
      } else {
        logoWrap.hidden = true;
      }
    }

    safeCall("address", () => renderAddress(data));

    const phoneCard = document.getElementById("info-phone");
    const phoneEl = document.getElementById("val-phone");
    if (data.phone && phoneCard && phoneEl) {
      phoneCard.hidden = false;
      const tel = String(data.phone).replace(/\s/g, "");
      phoneEl.href = `tel:${tel}`;
      phoneEl.textContent = data.phone;
    } else if (phoneCard) {
      phoneCard.hidden = true;
    }

    safeCall("hours", () => renderHours(data.hours_display));
    safeCall("daily-offer", () => renderDailyOffer(data.daily_offer));
    safeCall("gallery", () => renderGallery(data.gallery_urls));
    safeCall("reviews", () => renderReviews(data.reviews));
    safeCall("contact", () => renderContactActions(data));
    safeCall("menu", () => renderMenu(data.categories, data.menu));
    safeCall("order-links", () => bindOrderLinks(data.order_url || ""));
    safeCall("reveal", () => initScrollReveal());
    showScreen("screen-main");
  }

  async function loadPage() {
    const slug = getSlug();
    if (!slug) {
      document.getElementById("error-msg").textContent = "URL e pavlefshme.";
      showScreen("screen-error");
      return;
    }

    showScreen("screen-loading");
    registerSw(slug);
    initPwaBanner();

    try {
      const res = await fetch(`/api/r/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        document.getElementById("error-msg").textContent = data.gabim || "Restoranti nuk u gjet.";
        showScreen("screen-error");
        return;
      }
      renderPage(data);
    } catch (err) {
      console.error("[public-page] load failed:", err);
      document.getElementById("error-msg").textContent = friendlyError(err);
      showScreen("screen-error");
    }
  }

  loadPage();
})();
