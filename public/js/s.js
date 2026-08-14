(function () {
  const PWA_KEY = "ri_shop_pwa_dismissed";
  let deferredPrompt = null;
  let pageData = null;
  let activeCategory = "";
  let searchQuery = "";

  function getSlug() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] === "s" ? decodeURIComponent(parts[1] || "") : "";
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(el => {
      const on = el.id === id;
      el.classList.toggle("active", on);
      el.classList.toggle("hidden", !on);
    });
  }

  function euro(n) {
    return Number(n || 0).toFixed(2) + " €";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
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
      ? "Kliko Share (□↑) → Add to Home Screen."
      : "Instalo dyqanin në telefonin tuaj.";

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
    navigator.serviceWorker.register(`/s/${enc}/sw.js`, { scope: `/s/${enc}/` }).catch(() => {});
  }

  function applyTheme(color) {
    if (!color) return;
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--accent-soft", color + "1f");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", color);
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

  function googleMapsUrl(address) {
    const query = String(address || "").trim();
    if (!query) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function whatsAppProductUrl(product) {
    const wa = String(pageData?.whatsapp_url || "").trim();
    if (!wa) return null;
    const msg = `Përshëndetje! Jam i interesuar për: ${product.name} (${euro(product.price)})`;
    const sep = wa.includes("?") ? "&" : "?";
    return `${wa}${sep}text=${encodeURIComponent(msg)}`;
  }

  function getCategories() {
    if (pageData?.categories?.length) return pageData.categories;
    return [...new Set((pageData?.products || []).map(p => p.category).filter(Boolean))];
  }

  function filteredProducts() {
    const q = searchQuery.trim().toLowerCase();
    return (pageData?.products || []).filter(p => {
      if (activeCategory && p.category !== activeCategory) return false;
      if (!q) return true;
      const hay = [p.name, p.description, p.sku, p.category].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function renderCategoryPills() {
    const nav = document.getElementById("cat-pills");
    if (!nav) return;
    const cats = getCategories();
    if (!cats.length) {
      nav.innerHTML = "";
      return;
    }
    if (!activeCategory) activeCategory = "";

    const allBtn = `<button type="button" data-cat="" class="${!activeCategory ? "active" : ""}">Të gjitha</button>`;
    nav.innerHTML = allBtn + cats.map(cat =>
      `<button type="button" data-cat="${escapeAttr(cat)}" class="${cat === activeCategory ? "active" : ""}">${escapeHtml(cat)}</button>`,
    ).join("");

    nav.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        activeCategory = btn.getAttribute("data-cat") || "";
        renderCategoryPills();
        renderProducts();
      });
    });
  }

  function renderProducts() {
    const grid = document.getElementById("product-grid");
    const empty = document.getElementById("product-empty");
    const countEl = document.getElementById("product-count");
    if (!grid) return;

    const items = filteredProducts();
    if (countEl) {
      countEl.textContent = items.length === 1 ? "1 produkt" : `${items.length} produkte`;
    }

    if (!items.length) {
      grid.innerHTML = "";
      empty?.classList.remove("hidden");
      return;
    }
    empty?.classList.add("hidden");

    grid.innerHTML = items.map(p => {
      const img = p.photo_url
        ? `<img src="${escapeAttr(p.photo_url)}" alt="${escapeAttr(p.name)}" loading="lazy">`
        : `<div class="product-img-placeholder">🛍️</div>`;
      const badges = [];
      if (p.out_of_stock) badges.push('<span class="product-badge sold">Mbaroi</span>');
      else if (p.on_sale) badges.push('<span class="product-badge sale">Zbritje</span>');
      const compare = p.on_sale && p.compare_at_price
        ? `<span class="product-compare">${euro(p.compare_at_price)}</span>`
        : "";
      const desc = p.description
        ? `<p class="product-desc">${escapeHtml(p.description)}</p>`
        : "";
      const sku = p.sku ? `<div class="product-sku">SKU: ${escapeHtml(p.sku)}</div>` : "";

      let actions = "";
      if (p.out_of_stock) {
        actions = `<span class="product-btn product-btn-ghost" style="flex:1;opacity:0.7">Nuk ka stok</span>`;
      } else if (pageData?.order_url) {
        actions = `<a class="product-btn product-btn-primary" href="${escapeAttr(pageData.order_url)}">🛒 Porosit</a>`;
      } else {
        const wa = whatsAppProductUrl(p);
        if (wa) {
          actions = `<a class="product-btn product-btn-primary" href="${escapeAttr(wa)}" target="_blank" rel="noopener">💬 Pyet</a>`;
        }
      }
      if (p.photo_url) {
        actions += `<button type="button" class="product-btn product-btn-ghost photo-btn" data-photo="${escapeAttr(p.photo_url)}" data-name="${escapeAttr(p.name)}">Foto</button>`;
      }

      return `
        <article class="product-card${p.out_of_stock ? " out-of-stock" : ""}">
          <div class="product-img-wrap">
            ${badges.join("")}
            ${img}
          </div>
          <div class="product-body">
            <h3 class="product-name">${escapeHtml(p.name)}</h3>
            ${desc}
            ${sku}
            <div class="product-prices">
              <span class="product-price">${euro(p.price)}</span>
              ${compare}
            </div>
            <div class="product-actions">${actions}</div>
          </div>
        </article>`;
    }).join("");

    grid.querySelectorAll(".photo-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        openPhotoLightbox(btn.getAttribute("data-photo"), btn.getAttribute("data-name"));
      });
    });
  }

  function openPhotoLightbox(url, name) {
    const box = document.getElementById("photo-lightbox");
    const img = document.getElementById("photo-lightbox-img");
    const caption = document.getElementById("photo-lightbox-caption");
    if (!box || !img || !url) return;
    img.src = url;
    img.alt = name || "";
    if (caption) caption.textContent = name || "";
    box.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function bindLightbox() {
    const box = document.getElementById("photo-lightbox");
    const closeBtn = document.getElementById("photo-close");
    const close = () => {
      box?.classList.add("hidden");
      document.getElementById("photo-lightbox-img")?.removeAttribute("src");
      document.body.style.overflow = "";
    };
    closeBtn?.addEventListener("click", close);
    box?.addEventListener("click", (e) => { if (e.target === box) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !box?.classList.contains("hidden")) close();
    });
  }

  function renderGallery(urls) {
    const section = document.getElementById("gallery-section");
    const grid = document.getElementById("gallery-grid");
    const list = (urls || []).filter(Boolean);
    if (!section || !grid || !list.length) {
      section?.classList.add("hidden");
      return;
    }
    grid.innerHTML = list.map((url, idx) => `
      <button type="button" data-photo="${escapeAttr(url)}" data-name="Galeria ${idx + 1}">
        <img src="${escapeAttr(url)}" alt="Foto ${idx + 1}" loading="lazy">
      </button>
    `).join("");
    section.classList.remove("hidden");
    grid.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        openPhotoLightbox(btn.getAttribute("data-photo"), btn.getAttribute("data-name"));
      });
    });
  }

  function renderContact(data) {
    const wrap = document.getElementById("contact-actions");
    const waBtn = document.getElementById("btn-whatsapp");
    const socialEl = document.getElementById("social-links");
    const infoSection = document.getElementById("shop-info");
    let any = false;

    if (data.phone) {
      document.getElementById("info-phone")?.classList.remove("hidden");
      const phoneEl = document.getElementById("val-phone");
      if (phoneEl) {
        phoneEl.href = `tel:${data.phone.replace(/\s/g, "")}`;
        phoneEl.textContent = data.phone;
      }
      any = true;
    }

    const address = String(data.address || "").trim();
    if (address) {
      document.getElementById("info-address")?.classList.remove("hidden");
      const val = document.getElementById("val-address");
      if (val) val.textContent = address;
      const maps = data.maps_url || googleMapsUrl(address);
      const mapsBtn = document.getElementById("btn-maps-address");
      if (mapsBtn && maps) {
        mapsBtn.href = maps;
        mapsBtn.onclick = (e) => { e.preventDefault(); openExternalUrl(maps); };
      }
      any = true;
    }

    if (waBtn) {
      const wa = String(data.whatsapp_url || "").trim();
      if (wa) {
        waBtn.href = wa;
        waBtn.classList.remove("hidden");
        waBtn.onclick = (e) => { e.preventDefault(); openExternalUrl(wa); };
        any = true;
      }
    }

    if (socialEl) {
      const social = data.social || {};
      const items = [];
      if (social.instagram) items.push({ label: "Instagram", url: social.instagram });
      if (social.facebook) items.push({ label: "Facebook", url: social.facebook });
      if (social.tiktok) items.push({ label: "TikTok", url: social.tiktok });
      if (items.length) {
        socialEl.innerHTML = items.map(it =>
          `<a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.label)}</a>`,
        ).join("");
        socialEl.classList.remove("hidden");
        any = true;
      }
    }

    if (any) infoSection?.classList.remove("hidden");
  }

  function renderPage(data) {
    pageData = data;
    document.title = data.name || "Dyqani";
    applyTheme(data.theme_color);

    const appleIcon = document.getElementById("apple-icon");
    if (appleIcon && data.logo_url) appleIcon.href = data.logo_url;

    document.getElementById("biz-name").textContent = data.name || "Dyqani";

    const logo = document.getElementById("header-logo");
    if (logo && data.logo_url) {
      logo.src = data.logo_url;
      logo.alt = data.name;
      logo.classList.remove("hidden");
    }

    const hero = document.getElementById("shop-hero");
    const coverImg = document.getElementById("hero-cover");
    const heroDesc = document.getElementById("hero-desc");
    if (coverImg && data.cover_url) {
      coverImg.src = data.cover_url;
      coverImg.alt = data.name || "";
      hero?.classList.remove("hidden");
      if (heroDesc && data.description) heroDesc.textContent = data.description;
    } else if (data.description) {
      const tag = document.getElementById("biz-tagline");
      if (tag) {
        tag.textContent = data.description;
        tag.hidden = false;
      }
    }

    const offer = document.getElementById("daily-offer-banner");
    const offerText = document.getElementById("daily-offer-text");
    if (data.daily_offer && offer && offerText) {
      offerText.textContent = data.daily_offer;
      offer.classList.remove("hidden");
    }

    renderContact(data);
    renderGallery(data.gallery_urls);
    renderCategoryPills();
    renderProducts();

    const orderBar = document.getElementById("order-bar");
    const orderBtn = document.getElementById("btn-order");
    if (orderBar && orderBtn && data.order_url) {
      orderBtn.href = data.order_url;
      orderBar.classList.remove("hidden");
    }

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
    bindLightbox();

    document.getElementById("product-search")?.addEventListener("input", (e) => {
      searchQuery = e.target.value || "";
      renderProducts();
    });

    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        document.getElementById("error-msg").textContent = data.gabim || "Dyqani nuk u gjet.";
        showScreen("screen-error");
        return;
      }
      renderPage(data);
    } catch (err) {
      document.getElementById("error-msg").textContent = err.message || "Gabim rrjeti.";
      showScreen("screen-error");
    }
  }

  loadPage();
})();
