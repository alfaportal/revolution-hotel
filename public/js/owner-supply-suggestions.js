/** Owner panel — Sugjerime Furnizimi (pako_5 / AI) */
(function () {
  let suggestionsCache = [];
  let currentDate = "";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function qty(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return v.toFixed(3).replace(/\.?0+$/, "");
  }

  function setMsg(text, ok) {
    const el = document.getElementById("supply-suggestions-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function renderTable() {
    const body = document.getElementById("supply-suggestions-body");
    const summaryEl = document.getElementById("supply-suggestions-summary");
    const metaEl = document.getElementById("supply-suggestions-meta");
    if (!body) return;

    if (!suggestionsCache.length) {
      body.innerHTML =
        '<tr><td colspan="6" style="color:var(--muted)">Nuk ka sugjerime — stoku është në rregull ose gjeneroni listën.</td></tr>';
      if (summaryEl) summaryEl.textContent = "Ende nuk ka listë furnizimi për sot.";
      if (metaEl) metaEl.textContent = currentDate ? `Data: ${currentDate}` : "";
      return;
    }

    const aiSummary = suggestionsCache.find(s => s.ai_summary)?.ai_summary || "";
    if (summaryEl) summaryEl.textContent = aiSummary || "Lista e përbërësve që duhen porositur.";
    const emailSent = suggestionsCache.some(s => s.email_sent_at);
    if (metaEl) {
      metaEl.textContent = `Data: ${currentDate}${emailSent ? " · Email u dërgua" : ""}`;
    }

    body.innerHTML = suggestionsCache
      .map(s => {
        const supplier = s.last_supplier || "—";
        return `<tr>
          <td><strong>${esc(s.item_name)}</strong></td>
          <td>${qty(s.current_quantity)} ${esc(s.unit)}</td>
          <td>${qty(s.min_quantity)} ${esc(s.unit)}</td>
          <td><strong>${qty(s.order_quantity)} ${esc(s.unit)}</strong></td>
          <td>${esc(supplier)}</td>
          <td>
            <button type="button" class="btn btn-ghost btn-sm btn-supply-email"
              data-supplier="${esc(supplier)}"
              data-email="${esc(s.last_supplier_email || "")}">Dërgo Email</button>
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".btn-supply-email").forEach(btn => {
      btn.addEventListener("click", () => sendEmailForSupplier(btn.dataset.supplier, btn.dataset.email, btn));
    });
  }

  async function sendEmailForSupplier(supplierName, knownEmail, btn) {
    let to = String(knownEmail || "").trim();
    if (!to) {
      to = prompt(
        `Email i furnizuesit${supplierName && supplierName !== "—" ? ` (${supplierName})` : ""}:`,
        "",
      );
      if (!to) return;
    }

    if (btn) btn.disabled = true;
    setMsg("Duke dërguar email…", true);
    try {
      await api("/api/owner/supply-suggestions/send-email", {
        method: "POST",
        body: JSON.stringify({
          date: currentDate,
          supplier_name: supplierName === "—" ? "" : supplierName,
          to,
        }),
      });
      setMsg("Email u dërgua te furnizuesi.", true);
      await loadOwnerSupplySuggestions();
    } catch (err) {
      setMsg(err.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadOwnerSupplySuggestions() {
    setMsg("Duke ngarkuar…", true);
    try {
      const data = await api("/api/owner/supply-suggestions");
      suggestionsCache = data.suggestions || [];
      currentDate = data.date || data.today || "";
      renderTable();
      setMsg("", true);
    } catch (err) {
      suggestionsCache = [];
      renderTable();
      setMsg(err.message, false);
    }
  }

  async function generateToday(force = false) {
    const btn = document.getElementById("btn-supply-generate");
    if (btn) btn.disabled = true;
    setMsg("AI po analizon stokun…", true);
    try {
      const data = await api("/api/owner/supply-suggestions/generate", {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      suggestionsCache = data.suggestions || [];
      currentDate = data.date || currentDate;
      renderTable();
      setMsg(
        data.skipped
          ? "Lista për sot ekziston tashmë."
          : `${suggestionsCache.length} sugjerime u gjeneruan.`,
        true,
      );
    } catch (err) {
      setMsg(err.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function applySupplySuggestionsSection(data) {
    window.applyAiFeatureLock?.(document.getElementById("supply-suggestions-section"), data);
  }

  window.loadOwnerSupplySuggestions = loadOwnerSupplySuggestions;
  window.applySupplySuggestionsSection = applySupplySuggestionsSection;

  document.getElementById("btn-supply-generate")?.addEventListener("click", () => generateToday(false));
  document.getElementById("btn-supply-refresh")?.addEventListener("click", () => loadOwnerSupplySuggestions());
})();
