/** Owner panel — blerje manuale me filter kategorish. Ruaj → POS → stok + kontabilist. */
(function () {
  const api = () => window.ownerApi;
  let menuItems = [];
  let catFilter = null; // null = krejt
  let lines = [{ name: "", category: "", quantity: 1, unit_price: 0 }];

  function setMsg(text, ok) {
    const el = document.getElementById("blerje-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function categoryList() {
    const set = new Set();
    for (const it of menuItems) {
      const c = String(it.category || "").trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "sq"));
  }

  function itemsForDropdown(selectedName, lineCategory) {
    const cat = lineCategory || catFilter;
    let items = menuItems.slice();
    if (cat) {
      items = items.filter((it) => String(it.category || "").trim() === cat);
    }
    if (selectedName) {
      const sel = menuItems.find((m) => String(m.name || "").trim() === selectedName);
      if (sel && !items.some((m) => String(m.name || "").trim() === selectedName)) {
        items = [sel, ...items];
      }
    }
    items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "sq"));
    return items;
  }

  function renderCatFilter() {
    const bar = document.getElementById("blerje-cat-filter");
    if (!bar) return;
    const cats = categoryList();
    if (catFilter && !cats.includes(catFilter)) catFilter = null;
    const tabs = [{ key: null, label: "Krejt" }, ...cats.map((c) => ({ key: c, label: c }))];
    bar.innerHTML = tabs
      .map((t) => {
        const active = catFilter === t.key;
        const val = t.key === null ? "__all__" : encodeURIComponent(t.key);
        return `<button type="button" class="product-cat-tab${active ? " active" : ""}" data-blerje-cat="${val}" style="flex:0 0 auto;white-space:nowrap;padding:0.35rem 0.75rem;font-size:0.8rem;font-weight:700;border-radius:999px;cursor:pointer;border:1px solid ${active ? "#FF6B35" : "#3a3a55"};background:${active ? "#FF6B35" : "#252538"};color:#fff">${esc(t.label)}</button>`;
      })
      .join("");
    bar.querySelectorAll("[data-blerje-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const raw = btn.dataset.blerjeCat;
        catFilter = raw === "__all__" ? null : decodeURIComponent(raw || "");
        renderCatFilter();
        renderLines();
      });
    });
  }

  function productOptions(selectedName, lineCategory) {
    const opts = [`<option value="">— Zgjidh produktin —</option>`];
    const items = itemsForDropdown(selectedName, lineCategory);
    if (!catFilter && !lineCategory) {
      const byCat = new Map();
      for (const it of items) {
        const c = String(it.category || "").trim() || "Pa kategori";
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(it);
      }
      for (const [c, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], "sq"))) {
        opts.push(`<optgroup label="${esc(c)}">`);
        for (const it of list) {
          const n = String(it.name || "").trim();
          if (!n) continue;
          const sel = selectedName && selectedName === n ? " selected" : "";
          opts.push(`<option value="${esc(n)}"${sel}>${esc(n)}</option>`);
        }
        opts.push(`</optgroup>`);
      }
    } else {
      for (const it of items) {
        const n = String(it.name || "").trim();
        if (!n) continue;
        const sel = selectedName && selectedName === n ? " selected" : "";
        opts.push(`<option value="${esc(n)}"${sel}>${esc(n)}</option>`);
      }
    }
    return opts.join("");
  }

  function lineCatOptions(selectedCat) {
    const cats = categoryList();
    const opts = [`<option value="">— Kategoria —</option>`];
    for (const c of cats) {
      const sel = selectedCat === c ? " selected" : "";
      opts.push(`<option value="${esc(c)}"${sel}>${esc(c)}</option>`);
    }
    return opts.join("");
  }

  function renderLines() {
    const body = document.getElementById("blerje-lines-body");
    if (!body) return;
    body.innerHTML = lines
      .map(
        (line, idx) => `<tr>
        <td>
          <select class="blerje-line-cat" data-idx="${idx}" aria-label="Kategoria">${lineCatOptions(line.category || catFilter || "")}</select>
        </td>
        <td>
          <select class="blerje-line-product" data-idx="${idx}">${productOptions(line.name, line.category || catFilter)}</select>
        </td>
        <td><input type="number" class="blerje-line-qty" data-idx="${idx}" min="0.001" step="0.001" value="${Number(line.quantity) || 1}"></td>
        <td><input type="number" class="blerje-line-price" data-idx="${idx}" min="0" step="0.01" value="${Number(line.unit_price || 0).toFixed(2)}"></td>
        <td><button type="button" class="btn btn-ghost btn-sm blerje-line-del" data-idx="${idx}" ${lines.length <= 1 ? "disabled" : ""}>×</button></td>
      </tr>`,
      )
      .join("");

    body.querySelectorAll(".blerje-line-cat").forEach((el) => {
      el.addEventListener("change", () => {
        const i = Number(el.dataset.idx);
        lines[i].category = el.value;
        lines[i].name = "";
        renderLines();
      });
    });
    body.querySelectorAll(".blerje-line-product").forEach((el) => {
      el.addEventListener("change", () => {
        const i = Number(el.dataset.idx);
        lines[i].name = el.value;
        const hit = menuItems.find((m) => String(m.name || "").trim() === el.value);
        if (hit) {
          lines[i].category = String(hit.category || "").trim();
          if (!(Number(lines[i].unit_price) > 0) && Number(hit.price) > 0) {
            lines[i].unit_price = Number(hit.price);
          }
        }
        renderLines();
      });
    });
    body.querySelectorAll(".blerje-line-qty").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.dataset.idx);
        lines[i].quantity = Number(el.value);
      });
    });
    body.querySelectorAll(".blerje-line-price").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.dataset.idx);
        lines[i].unit_price = Number(el.value);
      });
    });
    body.querySelectorAll(".blerje-line-del").forEach((el) => {
      el.addEventListener("click", () => {
        const i = Number(el.dataset.idx);
        if (lines.length <= 1) return;
        lines.splice(i, 1);
        renderLines();
      });
    });
  }

  async function loadMenuForPurchase() {
    if (!api()) return;
    try {
      const data = await api()("/api/owner/menu");
      menuItems = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      menuItems = menuItems.filter((it) => it.active !== false && it.active !== 0);
    } catch {
      menuItems = [];
    }
    renderCatFilter();
    renderLines();
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function resetForm() {
    lines = [{ name: "", category: catFilter || "", quantity: 1, unit_price: 0 }];
    const dateEl = document.getElementById("blerje-invoice-date");
    if (dateEl && !dateEl.value) dateEl.value = todayIso();
    const sup = document.getElementById("blerje-supplier");
    const nui = document.getElementById("blerje-supplier-nui");
    const num = document.getElementById("blerje-invoice-no");
    const vat = document.getElementById("blerje-vat-rate");
    const kind = document.getElementById("blerje-kind");
    if (sup) sup.value = "";
    if (nui) nui.value = "";
    if (num) num.value = "";
    if (vat) vat.value = "18";
    if (kind) kind.value = "goods";
    renderLines();
  }

  async function savePurchase() {
    const supplier = document.getElementById("blerje-supplier")?.value?.trim() || "";
    const supplier_nui = document.getElementById("blerje-supplier-nui")?.value?.trim() || "";
    const invoice_number = document.getElementById("blerje-invoice-no")?.value?.trim() || "";
    const invoice_date = document.getElementById("blerje-invoice-date")?.value || todayIso();
    const vat_rate = Number(document.getElementById("blerje-vat-rate")?.value ?? 18);
    const purchase_kind = document.getElementById("blerje-kind")?.value || "goods";
    const items = lines
      .map((l) => ({
        name: String(l.name || "").trim(),
        quantity: Number(l.quantity),
        unit: "copë",
        pieces_per_pack: 1,
        unit_price: Number(l.unit_price) || 0,
      }))
      .filter((l) => l.name && l.quantity > 0);

    if (!supplier) {
      setMsg("Shkruani emrin e furnizuesit.", false);
      return;
    }
    if (!items.length) {
      setMsg("Zgjidhni kategori + produkt dhe sasi > 0.", false);
      return;
    }
    if (!api()) {
      setMsg("Sesioni nuk është gati. Rifresko faqen.", false);
      return;
    }

    const btn = document.getElementById("btn-blerje-save");
    if (btn) btn.disabled = true;
    setMsg("Duke dërguar blerjen te POS…", true);
    try {
      const data = await api()("/api/owner/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplier,
          supplier_nui,
          invoice_number,
          invoice_date,
          vat_rate,
          purchase_kind,
          items,
        }),
      });
      setMsg(
        data.message ||
          `U dërgua (${items.length} artikuj). POS e regjistron → stoku + Kontabilisti.`,
        true,
      );
      resetForm();
      if (typeof window.loadOwnerInventory === "function") {
        window.loadOwnerInventory().catch(() => {});
      }
      if (typeof window.loadOwnerStock === "function") {
        window.loadOwnerStock().catch(() => {});
      }
    } catch (err) {
      setMsg(err.message || "Ruajtja dështoi.", false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    const dateEl = document.getElementById("blerje-invoice-date");
    if (dateEl && !dateEl.value) dateEl.value = todayIso();
    document.getElementById("btn-blerje-add-line")?.addEventListener("click", () => {
      lines.push({ name: "", category: catFilter || "", quantity: 1, unit_price: 0 });
      renderLines();
    });
    document.getElementById("btn-blerje-save")?.addEventListener("click", () => {
      savePurchase().catch((e) => setMsg(e.message, false));
    });
    loadMenuForPurchase().catch(() => {
      renderCatFilter();
      renderLines();
    });
  }

  window.loadOwnerBlerjePanel = loadMenuForPurchase;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
