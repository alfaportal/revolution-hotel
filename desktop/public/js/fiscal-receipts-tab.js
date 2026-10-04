/**
 * Tab «Kuponët fiskalë» — anulim, kthim, ndërrim (parity me BIZNES tab-receipts).
 */
(function (global) {
  "use strict";

  const state = {
    returnLookup: null,
    exchangeLookup: null,
    menuItems: [],
  };

  const CORRECTION_REASON_PRESETS = [
    { id: "operator_error", label: "Gabim operatori" },
    { id: "customer_changed_mind", label: "Klienti u pendua" },
    { id: "wrong_price", label: "Çmim i gabuar" },
    { id: "wrong_item", label: "Artikull i gabuar" },
    { id: "duplicate_order", label: "Porosi e dyfishtë" },
    { id: "goods_return", label: "Kthim malli" },
    { id: "other", label: "Tjetër..." },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function euro(n) {
    return `${(Number(n) || 0).toFixed(2)} €`;
  }

  function setMsg(text, ok) {
    const el = $("kuponet-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok === true ? "var(--ngjyr-success,#22c55e)" : ok === false ? "#ef4444" : "#a0a0b8";
  }

  function fillNuikf(val) {
    const inp = $("kuponet-nuikf");
    if (inp) inp.value = String(val || "").trim().toUpperCase();
  }

  function getCorrectionReason() {
    const custom = ($("kuponet-reason-custom")?.value || "").trim();
    if (custom) return custom;
    const preset = ($("kuponet-reason-preset")?.value || "").trim();
    const p = CORRECTION_REASON_PRESETS.find((x) => x.id === preset);
    return p ? p.label : "";
  }

  function populateReasonMenu() {
    const menu = $("kuponet-reason-menu");
    const btn = $("kuponet-reason-btn");
    const hidden = $("kuponet-reason-preset");
    if (!menu || !btn || !hidden) return;
    const cur = hidden.value;
    menu.innerHTML = CORRECTION_REASON_PRESETS.map(
      (p) =>
        `<button type="button" role="option" data-reason-id="${esc(p.id)}" class="${cur === p.id ? "selected" : ""}">${esc(p.label)}</button>`
    ).join("");
    menu.querySelectorAll("button[data-reason-id]").forEach((el) => {
      el.addEventListener("click", () => {
        hidden.value = el.dataset.reasonId || "";
        btn.textContent = CORRECTION_REASON_PRESETS.find((p) => p.id === hidden.value)?.label || "— Zgjidh arsyen —";
        menu.hidden = true;
      });
    });
    btn.textContent =
      CORRECTION_REASON_PRESETS.find((p) => p.id === cur)?.label || "— Zgjidh arsyen —";
  }

  function menuVatLetter(it) {
    const c = String(it?.vat_category ?? "18");
    if (c === "0") return "A";
    if (c === "8") return "D";
    return "E";
  }

  async function ensureMenuLoaded() {
    if (state.menuItems.length) return;
    if (typeof global.api !== "function") return;
    const res = await global.api("/api/menu/all");
    state.menuItems = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
  }

  async function loadReceiptsTable(showFeedback) {
    const body = $("kuponet-tbody");
    if (!body || typeof global.api !== "function") return;
    if (showFeedback) setMsg("Duke rifreskuar kuponët…", null);
    try {
      const res = await global.api("/api/fiscal-receipts?limit=200&_=" + Date.now());
      const rows = Array.isArray(res.receipts) ? res.receipts : [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="9" style="color:#a0a0b8">Nuk ka kuponë</td></tr>';
        if (showFeedback) setMsg("0 kuponë", true);
        return;
      }
      body.innerHTML = rows
        .map((r) => {
          const atkOk = Number(r.sent_to_atk) === 1 || r.status === "Dërguar te ATK";
          const atkColor = atkOk ? "#4ade80" : "#fbbf24";
          const atkLbl = esc(r.status || (atkOk ? "ATK OK" : "Në pritje"));
          return `<tr>
            <td>${r.id}</td>
            <td><code>${esc(r.nuikf)}</code></td>
            <td>${esc(r.receipt_type_label || r.receipt_type)}</td>
            <td>${esc(r.daily_number)}</td>
            <td>${euro(r.total_amount)}</td>
            <td>${esc((r.fiscal_date || "") + " " + (r.fiscal_time || ""))}</td>
            <td>${esc(r.payment_label || r.payment_method)}</td>
            <td><strong style="color:${atkColor}">${atkLbl}</strong></td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-ghost btn-sm kuponet-act" data-nuikf="${esc(r.nuikf)}">Anulo</button>
              <button type="button" class="btn btn-ghost btn-sm kuponet-act-ex" data-nuikf="${esc(r.nuikf)}">Ndërrim</button>
              <button type="button" class="btn btn-primary btn-sm kuponet-act-ret" data-nuikf="${esc(r.nuikf)}">Kthim</button>
            </td>
          </tr>`;
        })
        .join("");
      body.querySelectorAll(".kuponet-act").forEach((b) => {
        b.addEventListener("click", () => {
          fillNuikf(b.dataset.nuikf);
          doCorrection("cancel");
        });
      });
      body.querySelectorAll(".kuponet-act-ret").forEach((b) => {
        b.addEventListener("click", () => {
          fillNuikf(b.dataset.nuikf);
          openReturnPanel();
        });
      });
      body.querySelectorAll(".kuponet-act-ex").forEach((b) => {
        b.addEventListener("click", () => {
          fillNuikf(b.dataset.nuikf);
          openExchangePanel();
        });
      });
      if (showFeedback) setMsg(`U rifreskua · ${rows.length} kuponë`, true);
    } catch (e) {
      body.innerHTML = `<tr><td colspan="9" style="color:#f87171">${esc(e.message)}</td></tr>`;
      setMsg(e.message, false);
    }
  }

  async function doCorrection(type) {
    const nuikf = ($("kuponet-nuikf")?.value || "").trim().toUpperCase();
    if (!nuikf) {
      setMsg("Vendos NUIKF ose numrin serik të bllokut (pas regjistrimit në SEF)", false);
      return;
    }
    const reason = getCorrectionReason();
    if ((type === "cancel" || type === "storno") && !reason) {
      setMsg("Zgjidhni arsyen ose shkruajeni manualisht", false);
      return;
    }
    try {
      const data = await global.api("/api/fiscal/storno", {
        method: "POST",
        body: JSON.stringify({
          nuikf,
          type,
          reason: reason || type + " ATK",
        }),
      });
      setMsg(
        `OK · ${type}\nOrigjinal: ${data.correction?.original_nuikf}\nI ri: ${data.correction?.nuikf}\n${data.atk_message || ""}`,
        !!data.atk_sent
      );
      await loadReceiptsTable(false);
    } catch (e) {
      setMsg(e.message, false);
    }
  }

  function closeReturnPanel() {
    $("kuponet-return-panel")?.setAttribute("hidden", "");
    state.returnLookup = null;
  }

  function closeExchangePanel() {
    $("kuponet-exchange-panel")?.setAttribute("hidden", "");
    state.exchangeLookup = null;
  }

  function getReturnLines() {
    const receipt = state.returnLookup;
    const wrap = $("kuponet-return-items");
    if (!receipt || !wrap) return [];
    const out = [];
    (receipt.items || []).forEach((it, idx) => {
      const qtyEl = wrap.querySelector(`.kuponet-return-qty[data-idx="${idx}"]`);
      const cb = wrap.querySelector(`.kuponet-return-pick[data-idx="${idx}"]`);
      if (cb && !cb.checked) return;
      const qty = Number(qtyEl?.value || 0);
      if (qty <= 0) return;
      out.push({
        name: it.name,
        quantity: qty,
        price: it.unit_price ?? it.price,
        unit_price: it.unit_price ?? it.price,
        vat_norm: it.vat_norm || "E",
      });
    });
    return out;
  }

  function renderReturnTable(receipt) {
    const wrap = $("kuponet-return-items");
    const sub = $("kuponet-return-sub");
    if (!wrap) return;
    if (sub) {
      sub.textContent = `NUIKF: ${receipt.nuikf} · ${receipt.fiscal_date || ""} · ${euro(receipt.total_amount)}`;
    }
    wrap.innerHTML =
      `<table class="kuponet-items-table"><thead><tr>
        <th></th><th>Artikulli</th><th>Çmimi</th><th>Mbetur</th><th>Kthe</th>
      </tr></thead><tbody>` +
      (receipt.items || [])
        .map((it, idx) => {
          const maxQ = Number(it.remaining_quantity ?? it.quantity) || 0;
          const price = Number(it.unit_price ?? it.price) || 0;
          const dis = maxQ <= 0;
          return `<tr${dis ? ' style="opacity:0.55"' : ""}>
            <td><input type="checkbox" class="kuponet-return-pick" data-idx="${idx}"${dis ? " disabled" : ""}></td>
            <td>${esc(it.name)}</td>
            <td>${euro(price)}</td>
            <td>${maxQ}</td>
            <td><input type="number" class="kuponet-return-qty" data-idx="${idx}" min="0" max="${maxQ}" step="0.01" value="0"${dis ? " disabled" : ""}></td>
          </tr>`;
        })
        .join("") +
      "</tbody></table>";
  }

  async function openReturnPanel() {
    const nuikf = ($("kuponet-nuikf")?.value || "").trim();
    if (!nuikf) {
      setMsg("Vendos NUIKF / numrin serik lart", false);
      return;
    }
    try {
      const data = await global.api("/api/fiscal/receipts/lookup?nuikf=" + encodeURIComponent(nuikf));
      const returnable = (data.receipt?.items || []).filter(
        (it) => (Number(it.remaining_quantity ?? it.quantity) || 0) > 0
      );
      if (!returnable.length) {
        closeReturnPanel();
        setMsg("Krejt artikujt janë kthyer", false);
        return;
      }
      closeExchangePanel();
      state.returnLookup = data.receipt;
      renderReturnTable(data.receipt);
      $("kuponet-return-panel")?.removeAttribute("hidden");
      setMsg(`Tabela e kthimit (${returnable.length} artikuj)`, true);
    } catch (e) {
      setMsg(e.message, false);
    }
  }

  async function confirmReturn() {
    const receipt = state.returnLookup;
    if (!receipt?.nuikf) {
      setMsg("Hap tabelën e kthimit së pari", false);
      return;
    }
    const items = getReturnLines();
    if (!items.length) {
      setMsg("Zgjidhni të paktën një artikull me sasi > 0", false);
      return;
    }
    const reason = getCorrectionReason() || "Kthim malli";
    try {
      const result = await global.api("/api/fiscal/storno", {
        method: "POST",
        body: JSON.stringify({
          nuikf: receipt.nuikf,
          type: "return",
          reason,
          items,
        }),
      });
      closeReturnPanel();
      setMsg(
        `Kthim OK · ${result.correction?.nuikf}\n${result.atk_message || ""}`,
        !!result.atk_sent
      );
      await loadReceiptsTable(false);
    } catch (e) {
      setMsg(e.message, false);
    }
  }

  function buildMenuOptions(vatLetter, selectedId) {
    const L = String(vatLetter || "E").toUpperCase();
    const list = state.menuItems.filter((m) => menuVatLetter(m) === L && m.active !== 0);
    return (
      '<option value="">— artikulli i ri —</option>' +
      list
        .map((m) => {
          const sel = Number(selectedId) === Number(m.id) ? " selected" : "";
          return `<option value="${m.id}"${sel}>${esc(m.name)} · ${euro(m.price)}</option>`;
        })
        .join("")
    );
  }

  function getExchangeLines() {
    const receipt = state.exchangeLookup;
    const wrap = $("kuponet-exchange-items");
    if (!receipt || !wrap) return [];
    const lines = [];
    for (let idx = 0; idx < (receipt.items || []).length; idx++) {
      const it = receipt.items[idx];
      const cb = wrap.querySelector(`.kuponet-ex-pick[data-idx="${idx}"]`);
      const qtyEl = wrap.querySelector(`.kuponet-ex-qty[data-idx="${idx}"]`);
      const newSel = wrap.querySelector(`.kuponet-ex-new[data-idx="${idx}"]`);
      if (!cb?.checked) continue;
      const qty = Number(qtyEl?.value || 0);
      const maxQ = Number(it.remaining_quantity ?? it.quantity) || 0;
      const price = Number(it.unit_price ?? it.price) || 0;
      const newId = Number(newSel?.value) || 0;
      if (qty <= 0 || qty > maxQ + 1e-9 || !newId) continue;
      lines.push({
        name: it.name,
        quantity: qty,
        unit_price: price,
        price,
        new_menu_item_id: newId,
      });
    }
    return lines;
  }

  function renderExchangeTable(receipt) {
    const wrap = $("kuponet-exchange-items");
    const sub = $("kuponet-exchange-sub");
    if (!wrap) return;
    if (sub) sub.textContent = `NUIKF: ${receipt.nuikf} · ${euro(receipt.total_amount)}`;
    wrap.innerHTML =
      `<table class="kuponet-items-table"><thead><tr>
        <th></th><th>Artikulli</th><th>Mbetur</th><th>Sasia</th><th>Artikulli i ri</th>
      </tr></thead><tbody>` +
      (receipt.items || [])
        .map((it, idx) => {
          const maxQ = Number(it.remaining_quantity ?? it.quantity) || 0;
          const vat = String(it.vat_norm || it.vat_letter || "E").toUpperCase();
          const dis = maxQ <= 0;
          return `<tr>
            <td><input type="checkbox" class="kuponet-ex-pick" data-idx="${idx}"${dis ? " disabled" : ""}></td>
            <td>${esc(it.name)}</td>
            <td>${maxQ}</td>
            <td><input type="number" class="kuponet-ex-qty" data-idx="${idx}" min="0" max="${maxQ}" step="0.01" value="0" disabled></td>
            <td><select class="kuponet-ex-new" data-idx="${idx}" disabled>${buildMenuOptions(vat, 0)}</select></td>
          </tr>`;
        })
        .join("") +
      "</tbody></table>";
    wrap.querySelectorAll(".kuponet-ex-pick").forEach((cb) => {
      cb.addEventListener("change", () => {
        const idx = cb.dataset.idx;
        const qty = wrap.querySelector(`.kuponet-ex-qty[data-idx="${idx}"]`);
        const sel = wrap.querySelector(`.kuponet-ex-new[data-idx="${idx}"]`);
        if (qty) qty.disabled = !cb.checked;
        if (sel) sel.disabled = !cb.checked;
      });
    });
  }

  async function openExchangePanel() {
    const nuikf = ($("kuponet-nuikf")?.value || "").trim();
    if (!nuikf) {
      setMsg("Vendos NUIKF lart", false);
      return;
    }
    await ensureMenuLoaded();
    try {
      const data = await global.api("/api/fiscal/receipts/lookup?nuikf=" + encodeURIComponent(nuikf));
      closeReturnPanel();
      state.exchangeLookup = data.receipt;
      renderExchangeTable(data.receipt);
      $("kuponet-exchange-panel")?.removeAttribute("hidden");
      setMsg("", null);
    } catch (e) {
      setMsg(e.message, false);
    }
  }

  async function confirmExchange() {
    const receipt = state.exchangeLookup;
    if (!receipt?.nuikf) {
      setMsg("Hap tabelën e ndërrimit së pari", false);
      return;
    }
    const lines = getExchangeLines();
    if (!lines.length) {
      setMsg("Zgjidh rreshta, sasi dhe artikullin e ri", false);
      return;
    }
    const reason = getCorrectionReason() || "Ndërrim artikulli ATK";
    const body = {
      nuikf: receipt.nuikf,
      exchange_lines: lines,
      reason,
      payment_method: "cash",
    };
    try {
      const data = await global.api("/api/fiscal/exchange", {
        method: "POST",
        body: JSON.stringify(body),
      });
      closeExchangePanel();
      setMsg(
        `Ndërrim OK · kthim ${data.return_coupon?.nuikf || "—"} · shitje e re ${data.sale_coupon?.nuikf || "—"}`,
        true
      );
      await loadReceiptsTable(false);
    } catch (e) {
      setMsg(e.message, false);
    }
  }

  function bindUiOnce() {
    if (bindUiOnce.done) return;
    bindUiOnce.done = true;
    populateReasonMenu();
    $("kuponet-reason-btn")?.addEventListener("click", () => {
      const menu = $("kuponet-reason-menu");
      if (menu) menu.hidden = !menu.hidden;
    });
    $("kuponet-refresh")?.addEventListener("click", () => loadReceiptsTable(true));
    $("kuponet-btn-cancel")?.addEventListener("click", () => doCorrection("cancel"));
    $("kuponet-btn-return")?.addEventListener("click", () => openReturnPanel());
    $("kuponet-btn-exchange")?.addEventListener("click", () => openExchangePanel());
    $("kuponet-return-close")?.addEventListener("click", closeReturnPanel);
    $("kuponet-return-confirm")?.addEventListener("click", confirmReturn);
    $("kuponet-exchange-close")?.addEventListener("click", closeExchangePanel);
    $("kuponet-exchange-confirm")?.addEventListener("click", confirmExchange);
  }

  async function initKuponetFiskaleTab() {
    bindUiOnce();
    await ensureMenuLoaded();
    await loadReceiptsTable(true);
  }

  global.initKuponetFiskaleTab = initKuponetFiskaleTab;
  global.fillKuponetNuikf = fillNuikf;
  global.openKuponetFiskaleTab = () => {
    if (typeof global.tryOpenAdminPanel === "function") {
      global.tryOpenAdminPanel("kuponet-fiskale");
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
