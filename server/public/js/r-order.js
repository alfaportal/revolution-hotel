(function () {
  let pageData = null;
  let orderType = "takeaway";
  let activeCategory = "";
  let cart = [];
  let orderSubmitting = false;

  function getSlug() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] === "r" ? decodeURIComponent(parts[1] || "") : "";
  }

  function publicPageUrl(slug) {
    return `/r/${encodeURIComponent(slug)}`;
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

  /** Si QR/panel: id (local_id) — Espresso… pastaj Çaj. */
  function menuSortedLikePanel(menu) {
    return (menu || []).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  }

  function applyTheme(color) {
    if (!color) return;
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--accent-dark", color);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", color);
  }

  function setBackLinks(slug) {
    const href = publicPageUrl(slug);
    ["back-link", "error-back", "success-back"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.href = href;
    });
  }

  function showFormError(msg) {
    const el = document.getElementById("form-error");
    if (!el) return;
    if (!msg) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function cartTotal() {
    return cart.reduce((sum, it) => sum + it.price * it.quantity, 0);
  }

  function cartCount() {
    return cart.reduce((sum, it) => sum + it.quantity, 0);
  }

  function findCartItem(name, price) {
    return cart.find(it => it.name === name && Number(it.price) === Number(price));
  }

  function addToCart(item) {
    const existing = findCartItem(item.name, item.price);
    if (existing) existing.quantity += 1;
    else cart.push({ name: item.name, price: Number(item.price), quantity: 1 });
    renderCart();
  }

  function changeQty(name, price, delta) {
    const item = findCartItem(name, price);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      cart = cart.filter(it => !(it.name === name && Number(it.price) === Number(price)));
    }
    renderCart();
  }

  function renderCart() {
    const lines = document.getElementById("cart-lines");
    const totalEl = document.getElementById("cart-total");
    const countEl = document.getElementById("cart-count");
    const submitBtn = document.getElementById("btn-submit");
    const count = cartCount();

    if (countEl) {
      countEl.textContent = count === 1 ? "1 artikull" : `${count} artikuj`;
    }
    if (totalEl) totalEl.textContent = euro(cartTotal());

    if (!lines) return;
    if (!cart.length) {
      lines.innerHTML = '<li class="order-cart-empty">Zgjidhni artikuj nga menuja.</li>';
    } else {
      lines.innerHTML = cart.map(it => `
        <li class="order-cart-line">
          <div class="order-cart-line-name">${escapeHtml(it.name)}</div>
          <div class="order-cart-line-controls">
            <button type="button" class="qty-btn" data-action="dec" data-name="${escapeAttr(it.name)}" data-price="${it.price}" aria-label="Zvogëlo">−</button>
            <span class="qty-val">${it.quantity}</span>
            <button type="button" class="qty-btn" data-action="inc" data-name="${escapeAttr(it.name)}" data-price="${it.price}" aria-label="Shto">+</button>
          </div>
          <div class="order-cart-line-price">${euro(it.price * it.quantity)}</div>
        </li>
      `).join("");

      lines.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-name") || "";
          const price = Number(btn.getAttribute("data-price"));
          changeQty(name, price, btn.dataset.action === "inc" ? 1 : -1);
        });
      });
    }

    if (submitBtn) submitBtn.disabled = count === 0;
  }

  function renderCategories() {
    const nav = document.getElementById("order-cat-nav");
    if (!nav || !pageData) return;
    const cats = pageData.categories?.length
      ? pageData.categories
      : [...new Set((pageData.menu || []).map(i => i.category).filter(Boolean))];

    if (!cats.length) {
      nav.innerHTML = "";
      return;
    }

    if (!activeCategory || !cats.includes(activeCategory)) {
      activeCategory = cats[0];
    }

    nav.innerHTML = cats.map(cat =>
      `<button type="button" data-cat="${escapeAttr(cat)}" class="${cat === activeCategory ? "active" : ""}">${escapeHtml(cat)}</button>`,
    ).join("");

    nav.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        activeCategory = btn.getAttribute("data-cat") || "";
        renderCategories();
        renderMenu();
      });
    });
  }

  function renderMenu() {
    const grid = document.getElementById("order-menu-grid");
    if (!grid || !pageData) return;

    const menu = menuSortedLikePanel(pageData.menu || []);
    if (!menu.length) {
      grid.innerHTML = '<p class="order-menu-empty">Menuja nuk është e disponueshme.</p>';
      return;
    }

    const items = menu.filter(it => !activeCategory || it.category === activeCategory);
    if (!items.length) {
      grid.innerHTML = '<p class="order-menu-empty">Nuk ka artikuj në këtë kategori.</p>';
      return;
    }

    grid.innerHTML = items.map(it => {
      const photoUrl = String(it.photo_url || "").trim();
      const photo = photoUrl
        ? `<span class="order-menu-item-photo"><img src="${escapeAttr(photoUrl)}" alt="" loading="lazy" decoding="async"></span>`
        : "";
      return `
      <button type="button" class="order-menu-item${photoUrl ? " has-photo" : ""}" data-id="${escapeAttr(it.id)}" data-name="${escapeAttr(it.name)}" data-price="${it.price}" data-desc="${escapeAttr(it.description || "")}" data-photo="${escapeAttr(photoUrl)}">
        ${photo}
        <span class="order-menu-item-name">${escapeHtml(it.name)}</span>
        <span class="order-menu-item-price">${euro(it.price)}</span>
        <span class="order-menu-item-add">+ Shto</span>
      </button>`;
    }).join("");

    grid.querySelectorAll(".order-menu-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = {
          id: btn.getAttribute("data-id"),
          name: btn.getAttribute("data-name") || "",
          price: Number(btn.getAttribute("data-price")),
          description: btn.getAttribute("data-desc") || "",
          photo_url: btn.getAttribute("data-photo") || "",
        };
        const add = () => {
          addToCart({ name: item.name, price: item.price });
          showFormError("");
        };
        if (window.MenuPosUI?.handleItemSelect) {
          MenuPosUI.handleItemSelect(item, btn, {
            onSelect: add,
            formatEuro: euro,
            getPhotoUrl: it => it.photo_url || "",
            theme: "dark",
            alwaysModal: true,
          });
        } else if (window.MenuPosUI?.openItemDetailModal) {
          MenuPosUI.openItemDetailModal(item, {
            formatEuro: euro,
            getPhotoUrl: it => it.photo_url || "",
            theme: "dark",
            onAdd: add,
          });
        } else {
          add();
        }
      });
      const img = btn.querySelector(".order-menu-item-photo img");
      if (img) {
        img.addEventListener("error", () => {
          img.closest(".order-menu-item-photo")?.remove();
          btn.classList.remove("has-photo");
        });
      }
    });
  }

  function googleMapsUrl(query) {
    const q = String(query || "").trim();
    if (!q) return "https://www.google.com/maps";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  function openExternalUrl(url) {
    if (!url) return;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(url);
  }

  function updateDeliveryFieldVisibility() {
    const field = document.getElementById("delivery-address-field");
    const input = document.getElementById("delivery-address");
    if (!field) return;
    const isDelivery = orderType === "delivery";
    field.classList.toggle("hidden", !isDelivery);
    if (input) input.required = isDelivery;
    if (!isDelivery && input) input.value = "";
  }

  function openDeliveryMaps() {
    const customerAddr = String(document.getElementById("delivery-address")?.value || "").trim();
    const hint = customerAddr || pageData?.address || pageData?.name || "";
    openExternalUrl(googleMapsUrl(hint));
  }

  function initOrderTypeToggle() {
    const subtitle = document.getElementById("order-subtitle");
    document.querySelectorAll(".order-type-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        orderType = btn.dataset.type === "delivery" ? "delivery" : "takeaway";
        document.querySelectorAll(".order-type-btn").forEach(b => {
          b.classList.toggle("active", b === btn);
        });
        if (subtitle) {
          subtitle.textContent = orderType === "delivery"
            ? "Dërgesë në adresën tuaj"
            : "Marrje në restorant";
        }
        updateDeliveryFieldVisibility();
      });
    });
    document.getElementById("btn-delivery-maps")?.addEventListener("click", openDeliveryMaps);
    updateDeliveryFieldVisibility();
  }

  function consumePendingItem() {
    try {
      const raw = sessionStorage.getItem("r_pending_item");
      if (!raw) return;
      sessionStorage.removeItem("r_pending_item");
      const item = JSON.parse(raw);
      if (item?.name) {
        addToCart({ name: String(item.name), price: Number(item.price) || 0 });
      }
    } catch { /* ignore */ }
  }

  function renderPage(data) {
    pageData = data;
    document.title = `Porosit — ${data.name || "Restorant"}`;
    applyTheme(data.theme_color);

    const title = document.getElementById("order-title");
    const subtitle = document.getElementById("order-subtitle");
    if (title) title.textContent = data.name || "Porosit online";
    if (subtitle) {
      subtitle.textContent = orderType === "delivery"
        ? "Dërgesë në adresën tuaj"
        : "Marrje në restorant";
    }

    activeCategory = MenuCatalog.pickDefaultCategory(data);
    renderCategories();
    renderMenu();
    consumePendingItem();
    renderCart();
    showScreen("screen-order");
  }

  async function submitOrder() {
    if (orderSubmitting) return;
    showFormError("");
    const slug = getSlug();
    const name = String(document.getElementById("customer-name")?.value || "").trim();
    const phone = String(document.getElementById("customer-phone")?.value || "").trim();
    const submitBtn = document.getElementById("btn-submit");

    if (!name) {
      showFormError("Vendosni emrin tuaj.");
      return;
    }
    if (!phone) {
      showFormError("Vendosni numrin e telefonit.");
      return;
    }
    const deliveryAddress = String(document.getElementById("delivery-address")?.value || "").trim();
    if (orderType === "delivery" && !deliveryAddress) {
      showFormError("Vendosni adresën e dërgesës.");
      return;
    }
    if (!cart.length) {
      showFormError("Shtoni të paktën një artikull.");
      return;
    }

    orderSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Duke dërguar…";

    try {
      const res = await fetch(`/api/r/${encodeURIComponent(slug)}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: name,
          customer_phone: phone,
          order_type: orderType,
          delivery_address: orderType === "delivery" ? deliveryAddress : "",
          items: cart,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.gabim || "Porosia nuk u dërgua.");
      }

      const kind = data.order_type === "delivery" ? "dërgesë" : "marrje";
      const msg = document.getElementById("success-msg");
      if (msg) {
        msg.textContent = `Faleminderit ${data.customer_name || name}! Porosia juaj për ${kind} u dërgua te restoranti. Do t'ju kontaktojmë në ${phone}.`;
      }
      showScreen("screen-success");
    } catch (err) {
      showFormError(err.message || "Gabim rrjeti.");
      submitBtn.disabled = cartCount() === 0;
      submitBtn.textContent = "Dërgo Porosinë";
    } finally {
      orderSubmitting = false;
    }
  }

  async function loadPage() {
    const slug = getSlug();
    setBackLinks(slug);

    if (!slug) {
      document.getElementById("error-msg").textContent = "URL e pavlefshme.";
      showScreen("screen-error");
      return;
    }

    showScreen("screen-loading");
    initOrderTypeToggle();
    document.getElementById("btn-submit")?.addEventListener("click", submitOrder);

    try {
      const res = await fetch(`/api/r/${encodeURIComponent(slug)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        document.getElementById("error-msg").textContent = data.gabim || "Restoranti nuk u gjet.";
        showScreen("screen-error");
        return;
      }
      if (!data.order_url) {
        document.getElementById("error-msg").textContent = "Porositë online nuk janë të aktivizuara për këtë restorant.";
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
