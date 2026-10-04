/**
 * Tab «Blloku i letrës» — HOTEL admin (parity BIZNES / KAFENE).
 */
(function (global) {
  "use strict";

  let menuCatalog = [];
  let uiBound = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function escAttr(s) {
    return esc(s).replace(/'/g, "&#39;");
  }

  function euro(n) {
    return `${(Number(n) || 0).toFixed(2)} €`;
  }

  function setPaperBlockMsg(text, ok) {
    const msg = document.getElementById("paper-block-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.color = ok === true ? "#27ae60" : ok === false ? "#ef4444" : "#a0a0b8";
  }

  global.setPaperBlockMsg = setPaperBlockMsg;

  function paperBlockVatLetterFromMenuItem(it) {
    if (!it) return "E";
    if (typeof SalesInvoiceHtml !== "undefined" && SalesInvoiceHtml.vatLetterFromCategory) {
      return SalesInvoiceHtml.vatLetterFromCategory(it.vat_category);
    }
    const c = String(it?.vat_category ?? "18");
    if (c === "0") return "A";
    if (c === "8") return "D";
    return "E";
  }

  function paperIssueVatOptions(selected) {
    return ["A", "C", "D", "E"]
      .map(
        (L) =>
          `<option value="${L}" ${String(selected || "E").toUpperCase() === L ? "selected" : ""}>${L}</option>`
      )
      .join("");
  }

  async function ensureMenuCatalog(forceReload) {
    if (typeof global.api !== "function") return;
    if (!forceReload && menuCatalog.length) return;
    const res = await global.api("/api/menu/all");
    menuCatalog = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
  }

  function paperProductDisplayName(p) {
    return String(p?.name || p?.emri || p?.label || "").trim();
  }

  function paperBlockRowStatusLabel(row, fiscalById) {
    const fid = row.registered_fiscal_receipt_id;
    if (!fid) {
      return { icon: "🟡", label: "Në pritje — i ruajtur, ende pa shkuar te ATK" };
    }
    const fr = fiscalById && fiscalById.get(Number(fid));
    const atkOk = !!(fr && (fr.atk_ok || Number(fr.sent_to_atk) === 1));
    if (atkOk) {
      return { icon: "🟢", label: "Dërguar — ka shkuar me sukses te ATK" };
    }
    return { icon: "🟡", label: "Në pritje — i ruajtur, ende pa shkuar te ATK" };
  }

  function renderPaperBlockStatus(status, allReceipts, fiscalById) {
    const box = document.getElementById("paper-block-box");
    const list = document.getElementById("paper-block-list");
    const issueWrap = document.getElementById("paper-block-issue-wrap");
    if (!box) return;

    const active = !!(status && status.active);
    if (issueWrap) issueWrap.hidden = !active;

    if (!status) {
      box.hidden = true;
      box.textContent = "";
      if (list) list.innerHTML = "";
      return;
    }

    if (status.active || status.pending_count > 0) {
      box.hidden = false;
      const lines = [];
      if (status.active) {
        const autoLine = status.auto_enabled
          ? "AUTO — SEF ndaloi, u aktivizua automatikisht"
          : "Modalitet AKTIV";
        lines.push(`${autoLine} — batch: ${status.batch_id || "—"}`);
        if (status.auto_reason) lines.push(`Arsye auto: ${status.auto_reason}`);
        if (status.sef_last_failure_msg) lines.push(`Gabimi: ${status.sef_last_failure_msg}`);
        lines.push(`Filloi: ${status.started_at || "—"} · ${status.hours_since_failure ?? 0}h`);
        if (status.register_deadline_at) {
          lines.push(`Afati regjistrim SEF: ${String(status.register_deadline_at).slice(0, 10)}`);
        }
      }
      if (status.message) lines.push(status.message);
      box.textContent = lines.join("\n");
    } else {
      box.hidden = true;
      box.textContent = "";
    }

    if (list) {
      const rows = Array.isArray(allReceipts)
        ? allReceipts.slice().sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 30)
        : (status.pending || []).slice(0, 20);
      if (!rows.length) {
        list.innerHTML = "<li>Nuk ka kuponë të regjistruar për bllokimin e letrës.</li>";
      } else {
        list.innerHTML = rows
          .map((p) => {
            const st = paperBlockRowStatusLabel(p, fiscalById);
            const fid = Number(p.registered_fiscal_receipt_id) || 0;
            const fr = fid ? fiscalById.get(fid) : null;
            const nuikf = fr?.nuikf ? String(fr.nuikf) : "";
            const corrBtns = nuikf
              ? ` <button type="button" class="btn btn-ghost btn-sm paper-kuponet-nuikf" data-nuikf="${escAttr(nuikf)}" style="margin-left:6px;padding:2px 6px;font-size:0.75rem">Korrigjo</button>`
              : "";
            return `<li>${st.icon} <strong>${esc(String(p.serial_no || "—"))}</strong>${nuikf ? ` · NUIKF <code>${esc(nuikf)}</code>` : ""} · ${esc(String(p.fiscal_date || "—"))} · ${Number(p.total_amount || 0).toFixed(2)} € — ${esc(st.label)}${corrBtns}</li>`;
          })
          .join("");
        list.querySelectorAll(".paper-kuponet-nuikf").forEach((btn) => {
          btn.addEventListener("click", () => {
            const n = btn.getAttribute("data-nuikf") || "";
            if (typeof global.fillKuponetNuikf === "function") global.fillKuponetNuikf(n);
            if (typeof global.tryOpenAdminPanel === "function") global.tryOpenAdminPanel("kuponet-fiskale");
          });
        });
      }
    }
  }

  async function refreshPaperBlockUi() {
    if (typeof global.api !== "function") return;
    try {
      const [data, receiptsData] = await Promise.all([
        global.api("/api/fiscal/paper-block"),
        global.api("/api/fiscal-receipts?limit=500&_=" + Date.now()).catch(() => ({ receipts: [] })),
      ]);
      const fiscalById = new Map((receiptsData.receipts || []).map((r) => [Number(r.id), r]));
      renderPaperBlockStatus(data.status, data.receipts, fiscalById);
    } catch {
      renderPaperBlockStatus(null, [], new Map());
    }
    if (typeof global.refreshOfflineComplianceUi === "function") {
      await global.refreshOfflineComplianceUi().catch(() => {});
    }
  }

  global.refreshPaperBlockUi = refreshPaperBlockUi;

  function hidePaperProductResults() {
    const box = document.getElementById("paper-product-results");
    if (box) {
      box.classList.add("hidden");
      box.innerHTML = "";
    }
  }

  function filterPaperCatalogProducts(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    if (/^\d+$/.test(q)) {
      const id = Number(q);
      const byId = menuCatalog.filter((p) => Number(p.id) === id);
      if (byId.length) return byId.slice(0, 12);
    }
    return menuCatalog
      .filter((p) => paperProductDisplayName(p).toLowerCase().includes(q))
      .slice(0, 12);
  }

  function renderPaperProductResults(query) {
    const box = document.getElementById("paper-product-results");
    if (!box) return;
    const hits = filterPaperCatalogProducts(query);
    if (!String(query || "").trim() || !hits.length) {
      hidePaperProductResults();
      return;
    }
    box.innerHTML = hits
      .map((p) => {
        const L = paperBlockVatLetterFromMenuItem(p);
        return `<button type="button" data-paper-pick-id="${Number(p.id)}" role="option">
            ${esc(paperProductDisplayName(p))}
            <span class="paper-pick-meta">${euro(p.price ?? p.cmimi)} · ${esc(L)} · ${esc(String(p.unit_code || "EA"))}</span>
          </button>`;
      })
      .join("");
    box.classList.remove("hidden");
  }

  function addPaperIssueItemRow(prefill, opts = {}) {
    const host = document.getElementById("paper-issue-items");
    if (!host) return;
    const catalog = !!opts.catalog;
    const row = document.createElement("div");
    row.className = "paper-issue-row";
    row.dataset.source = catalog ? "catalog" : "manual";
    row.style.cssText =
      "display:grid;grid-template-columns:minmax(100px,1fr) 52px 72px 96px 64px 36px;gap:8px;align-items:center;margin-bottom:6px;max-width:780px";
    const p = prefill && typeof prefill === "object" ? prefill : {};
    if (catalog && p.product_id != null) row.dataset.productId = String(p.product_id);
    if (p.unit_code) row.dataset.unitCode = String(p.unit_code);
    if (p.category_code) row.dataset.categoryCode = String(p.category_code);
    const vat = p.vat_norm || p.vat_letter || "E";
    const ro = catalog ? " readonly" : "";
    const disSel = catalog ? " disabled" : "";
    row.innerHTML = `
        <input type="text" data-field="name" placeholder="Emri" value="${escAttr(String(p.name || ""))}"${ro} />
        <input type="text" data-field="unit" value="${escAttr(String(p.unit_code || "EA"))}" readonly tabindex="-1" style="text-align:center;font-size:0.78rem;padding:6px 4px" />
        <input type="number" data-field="qty" min="0.0001" step="0.0001" value="${p.quantity != null ? p.quantity : 1}" />
        <input type="number" data-field="price" min="0" step="0.01" value="${p.unit_price != null ? p.unit_price : p.price != null ? p.price : ""}"${ro} />
        <select data-field="vat"${disSel}>${paperIssueVatOptions(vat)}</select>
        <button type="button" class="btn btn-ghost" data-act="remove-row" style="width:auto;padding:6px 8px;min-width:0" title="Hiq rreshtin">×</button>
      `;
    host.appendChild(row);
    row.querySelector('[data-act="remove-row"]')?.addEventListener("click", () => {
      row.remove();
      updatePaperIssueTotalHint();
    });
    row.querySelectorAll("input,select").forEach((el) => {
      el.addEventListener("input", updatePaperIssueTotalHint);
      el.addEventListener("change", updatePaperIssueTotalHint);
    });
    updatePaperIssueTotalHint();
  }

  function addPaperIssueItemFromProduct(productId) {
    const p = menuCatalog.find((m) => Number(m.id) === Number(productId));
    if (!p) return false;
    const vatLetter = paperBlockVatLetterFromMenuItem(p);
    const price = Number(p.price ?? p.cmimi ?? 0);
    addPaperIssueItemRow(
      {
        product_id: p.id,
        name: paperProductDisplayName(p),
        quantity: 1,
        unit_price: price,
        price,
        vat_norm: vatLetter,
        unit_code: p.unit_code || "EA",
        category_code: p.category_code || "TT",
      },
      { catalog: true }
    );
    return true;
  }

  function collectPaperIssueItems(opts = {}) {
    const allowEmpty = !!opts.allowEmpty;
    const rows = document.querySelectorAll("#paper-issue-items .paper-issue-row");
    const items = [];
    for (const row of rows) {
      const name = String(row.querySelector('[data-field="name"]')?.value || "").trim();
      const qty = Number(row.querySelector('[data-field="qty"]')?.value);
      const unit_price = Number(row.querySelector('[data-field="price"]')?.value);
      let vat_norm = String(row.querySelector('[data-field="vat"]')?.value || "E").trim().toUpperCase();
      if (!name && allowEmpty) continue;
      if (!name && !allowEmpty) continue;
      if (!Number.isFinite(qty) || qty <= 0) {
        if (!allowEmpty) throw new Error(`Sasia e pavlefshme për "${name || "artikull"}"`);
        continue;
      }
      if (!Number.isFinite(unit_price) || unit_price < 0) {
        if (!allowEmpty) throw new Error(`Çmimi i pavlefshëm për "${name}"`);
        continue;
      }
      if (!/^[A-E]$/.test(vat_norm)) vat_norm = "E";
      const item = {
        name,
        quantity: qty,
        qty,
        unit_price,
        price: unit_price,
        vat_norm,
        vat_letter: vat_norm,
      };
      const pid = row.dataset.productId;
      if (pid) {
        item.product_id = Number(pid);
        item.menu_item_id = Number(pid);
      }
      const unitCode = row.dataset.unitCode || row.querySelector('[data-field="unit"]')?.value;
      const catCode = row.dataset.categoryCode;
      if (unitCode) item.unit_code = String(unitCode).trim();
      if (catCode) item.category_code = String(catCode).trim();
      items.push(item);
    }
    return items;
  }

  function updatePaperIssueTotalHint() {
    const hint = document.getElementById("paper-issue-total-hint");
    if (!hint) return;
    const items = collectPaperIssueItems({ allowEmpty: true });
    if (!items.length) {
      hint.textContent = "";
      return;
    }
    const sum = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
    hint.textContent = `Nën-totali (bruto): ${sum.toFixed(2)} € · ${items.length} artikuj`;
  }

  function prefillPaperIssueSaleDateTime() {
    const dateEl = document.getElementById("paper-sale-date");
    const timeEl = document.getElementById("paper-sale-time");
    const d = new Date();
    if (dateEl && !dateEl.value) {
      dateEl.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (timeEl && !timeEl.value) {
      timeEl.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }

  function paperIssueFiscalDateTimeFromInputs() {
    prefillPaperIssueSaleDateTime();
    const iso = String(document.getElementById("paper-sale-date")?.value || "").trim();
    const tm = String(document.getElementById("paper-sale-time")?.value || "").trim();
    if (!iso) throw new Error("Vendosni datën e shitjes fizike.");
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error("Data e shitjes nuk është e vlefshme.");
    const fiscal_date = `${m[3]}.${m[2]}.${m[1]}`;
    let fiscal_time = "12:00";
    if (tm) {
      const t = /^(\d{1,2}):(\d{2})/.exec(tm);
      if (!t) throw new Error("Ora e shitjes nuk është e vlefshme.");
      fiscal_time = `${String(t[1]).padStart(2, "0")}:${t[2]}`;
    }
    return { fiscal_date, fiscal_time };
  }

  function bindPaperBlockUiOnce() {
    if (uiBound) return;
    uiBound = true;

    document.getElementById("paper-product-search")?.addEventListener("focus", () => {
      ensureMenuCatalog(true).catch(() => {});
    });
    document.getElementById("paper-product-search")?.addEventListener("input", (e) => {
      ensureMenuCatalog(false)
        .then(() => renderPaperProductResults(e.target.value))
        .catch(() => hidePaperProductResults());
    });
    document.getElementById("paper-product-search")?.addEventListener("keydown", (e) => {
      const box = document.getElementById("paper-product-results");
      const first = box?.querySelector("[data-paper-pick-id]");
      if (e.key === "Enter") {
        e.preventDefault();
        if (first) {
          addPaperIssueItemFromProduct(first.dataset.paperPickId);
          e.target.value = "";
          hidePaperProductResults();
          return;
        }
        const hits = filterPaperCatalogProducts(e.target.value);
        if (hits.length === 1) {
          addPaperIssueItemFromProduct(hits[0].id);
          e.target.value = "";
          hidePaperProductResults();
        }
      } else if (e.key === "Escape") hidePaperProductResults();
    });
    document.getElementById("paper-product-results")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-paper-pick-id]");
      if (!btn) return;
      addPaperIssueItemFromProduct(btn.dataset.paperPickId);
      const inp = document.getElementById("paper-product-search");
      if (inp) inp.value = "";
      hidePaperProductResults();
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#paper-product-search") || e.target.closest("#paper-product-results")) return;
      hidePaperProductResults();
    });

    document.getElementById("btn-paper-add-item")?.addEventListener("click", () => {
      prefillPaperIssueSaleDateTime();
      addPaperIssueItemRow({}, { catalog: false });
    });

    document.getElementById("btn-paper-issue-submit")?.addEventListener("click", async () => {
      const serial = String(document.getElementById("paper-serial-no")?.value || "").trim();
      if (!serial) {
        setPaperBlockMsg("Numri serik i bllokut letër mungon.", false);
        return;
      }
      let saleWhen;
      try {
        saleWhen = paperIssueFiscalDateTimeFromInputs();
      } catch (err) {
        setPaperBlockMsg(err.message || String(err), false);
        return;
      }
      let items;
      try {
        items = collectPaperIssueItems();
      } catch (err) {
        setPaperBlockMsg(err.message || String(err), false);
        return;
      }
      if (!items.length) {
        setPaperBlockMsg("Shtoni të paktën një artikull.", false);
        return;
      }
      const btn = document.getElementById("btn-paper-issue-submit");
      if (btn) btn.disabled = true;
      try {
        const u = global.user || {};
        const data = await global.api("/api/fiscal/paper-block/issue", {
          method: "POST",
          body: JSON.stringify({
            serial_no: serial,
            items,
            fiscal_date: saleWhen.fiscal_date,
            fiscal_time: saleWhen.fiscal_time,
            operator_name: u.emri || "Operator",
            operator_id: String(u.id || u.userId || "POS"),
            payment_method: "cash",
          }),
        });
        const paper = data.paper || {};
        setPaperBlockMsg(
          `Kuponi u regjistrua: serik ${paper.serial_no || serial} · totali ${Number(paper.total_amount || 0).toFixed(2)} €`,
          true
        );
        document.getElementById("paper-serial-no").value = "";
        document.getElementById("paper-issue-items").innerHTML = "";
        document.getElementById("paper-product-search").value = "";
        hidePaperProductResults();
        updatePaperIssueTotalHint();
        await refreshPaperBlockUi();
      } catch (err) {
        setPaperBlockMsg(err.message || String(err), false);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById("btn-paper-enable")?.addEventListener("click", async () => {
      if (
        !window.confirm(
          "Aktivizoni bllokimin e letrës?\n\nPërdoreni vetëm kur SEF ndalon plotësisht."
        )
      ) {
        return;
      }
      try {
        const data = await global.api("/api/fiscal/paper-block/enable", {
          method: "POST",
          body: JSON.stringify({ operator_name: global.user?.emri || "Admin" }),
        });
        setPaperBlockMsg("Bllokimi i letrës u aktivizua.", true);
        renderPaperBlockStatus(data.status, data.receipts || [], new Map());
      } catch (e) {
        setPaperBlockMsg(e.message, false);
      }
    });

    document.getElementById("btn-paper-disable")?.addEventListener("click", async () => {
      if (!window.confirm("Çaktivizo bllokimin e letrës?")) return;
      try {
        const data = await global.api("/api/fiscal/paper-block/disable", {
          method: "POST",
          body: JSON.stringify({ operator_name: global.user?.emri || "Admin", force: false }),
        });
        setPaperBlockMsg("Bllokimi i letrës u çaktivizua.", true);
        renderPaperBlockStatus(data.status, [], new Map());
      } catch (e) {
        const forceOk = window.confirm((e.message || "Gabim") + "\n\nÇaktivizo GJITHSESI?");
        if (!forceOk) {
          setPaperBlockMsg(e.message, false);
          return;
        }
        try {
          const data = await global.api("/api/fiscal/paper-block/disable", {
            method: "POST",
            body: JSON.stringify({ operator_name: global.user?.emri || "Admin", force: true }),
          });
          setPaperBlockMsg("U çaktivizua me force.", false);
          renderPaperBlockStatus(data.status, [], new Map());
        } catch (e2) {
          setPaperBlockMsg(e2.message, false);
        }
      }
    });

    document.getElementById("btn-paper-register-all")?.addEventListener("click", async () => {
      if (!window.confirm("Regjistroni të gjithë kuponët e bllokut letër në SEF dhe dërgo te ATK?")) return;
      try {
        const data = await global.api("/api/fiscal/paper-block/register-all", {
          method: "POST",
          body: JSON.stringify({ operator_name: global.user?.emri || "Admin" }),
        });
        setPaperBlockMsg(
          `Përpunuar: ${data.processed} · Sukses: ${data.success} · Dështuar: ${data.failed}`,
          data.failed === 0
        );
        await refreshPaperBlockUi();
      } catch (e) {
        setPaperBlockMsg(e.message, false);
      }
    });
  }

  async function initHotelPaperBlockTab() {
    bindPaperBlockUiOnce();
    try {
      await ensureMenuCatalog(true);
    } catch (e) {
      setPaperBlockMsg(e.message || "Katalogu i produkteve nuk u lexua.", false);
    }
    prefillPaperIssueSaleDateTime();
    await refreshPaperBlockUi();
  }

  global.initHotelPaperBlockTab = initHotelPaperBlockTab;
})(typeof window !== "undefined" ? window : globalThis);
