(function () {
  const API = "/api/suppliers";
  let payId = 0;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function euro(n) {
    return `${(Number(n) || 0).toFixed(2)} €`;
  }

  async function callApi(path, opts) {
    if (typeof api === "function") return api(path, opts);
    const r = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.gabim || j.error || r.statusText);
    return j;
  }

  function msg(text) {
    const el = document.getElementById("sup-msg");
    if (el) el.textContent = text || "";
  }

  function clearForm() {
    const id = document.getElementById("sup-id");
    if (id) id.value = "";
    ["sup-name", "sup-phone", "sup-email", "sup-address", "sup-nui", "sup-vat"].forEach((k) => {
      const el = document.getElementById(k);
      if (el) el.value = "";
    });
  }

  async function load() {
    const body = document.getElementById("sup-list-body");
    if (!body) return;
    const data = await callApi(`${API}?balance=1`);
    const rows = data.suppliers || [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="purchases-empty">Nuk ka furnitorë. Shtoni nga forma ose nga fatura e blerjes.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((s) => {
      const bal = Number(s.balance) || 0;
      const style = bal > 0.004 ? "color:#b91c1c;font-weight:700" : "";
      return `<tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.phone || "")}</td>
        <td>${esc(s.nui || "")}</td>
        <td>${euro(s.purchased)}</td>
        <td>${euro(s.paid)}</td>
        <td style="${style}">${euro(s.balance)}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-sm" data-sup-edit="${s.id}">Ndrysho</button>
          <button type="button" class="btn btn-ghost btn-sm" data-sup-pay="${s.id}">Pagesë</button>
          <button type="button" class="btn btn-ghost btn-sm" data-sup-delete="${s.id}">Fshi</button>
        </td>
      </tr>`;
    }).join("");
  }

  async function openPay(id) {
    payId = Number(id);
    const data = await callApi(`${API}/${payId}`);
    const s = data.supplier || {};
    const card = document.getElementById("sup-pay-card");
    if (card) card.hidden = false;
    document.getElementById("sup-pay-title").textContent = `Pagesë — ${s.name} (borxh ${euro(s.balance)})`;
    document.getElementById("sup-pay-amount").value = s.balance > 0 ? Number(s.balance).toFixed(2) : "";
    document.getElementById("sup-pay-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("sup-pay-note").value = "";
    const list = document.getElementById("sup-pay-list");
    const pays = data.payments || [];
    list.innerHTML = pays.length
      ? pays.map((p) => `<tr><td>${esc(p.paid_at)}</td><td>${euro(p.amount)}</td><td>${esc(p.note || "")}</td></tr>`).join("")
      : '<tr><td colspan="3" class="purchases-empty">Nuk ka pagesa.</td></tr>';
  }

  document.getElementById("btn-sup-save")?.addEventListener("click", async () => {
    try {
      await callApi(API, {
        method: "POST",
        body: JSON.stringify({
          id: document.getElementById("sup-id").value || undefined,
          name: document.getElementById("sup-name").value,
          phone: document.getElementById("sup-phone").value,
          email: document.getElementById("sup-email").value,
          address: document.getElementById("sup-address").value,
          nui: document.getElementById("sup-nui").value,
          vat_number: document.getElementById("sup-vat").value,
        }),
      });
      msg("Furnitori u ruajt.");
      clearForm();
      await load();
    } catch (e) {
      msg(e.message || "Ruajtja dështoi.");
    }
  });

  document.getElementById("sup-list-body")?.addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-sup-edit]");
    const pay = e.target.closest("[data-sup-pay]");
    const del = e.target.closest("[data-sup-delete]");
    if (del) {
      const sid = Number(del.dataset.supDelete);
      if (!sid) return;
      if (!confirm("Fshi këtë furnitor?")) return;
      try {
        await callApi(`${API}/${sid}`, { method: "DELETE" });
        msg("Furnitori u fshi.");
        if (Number(document.getElementById("sup-id")?.value) === sid) clearForm();
        if (payId === sid) {
          const card = document.getElementById("sup-pay-card");
          if (card) card.hidden = true;
          payId = 0;
        }
        await load();
      } catch (err) {
        msg(err.message || "Fshirja dështoi.");
      }
      return;
    }
    if (edit) {
      try {
        const data = await callApi(`${API}/${edit.dataset.supEdit}`);
        const s = data.supplier || {};
        document.getElementById("sup-id").value = s.id || "";
        document.getElementById("sup-name").value = s.name || "";
        document.getElementById("sup-phone").value = s.phone || "";
        document.getElementById("sup-email").value = s.email || "";
        document.getElementById("sup-address").value = s.address || "";
        document.getElementById("sup-nui").value = s.nui || "";
        document.getElementById("sup-vat").value = s.vat_number || "";
        document.getElementById("sup-name").focus();
      } catch (err) {
        msg(err.message || "Nuk u ngarkua.");
      }
    }
    if (pay) openPay(pay.dataset.supPay).catch((err) => msg(err.message || "Gabim"));
  });

  document.getElementById("btn-sup-pay")?.addEventListener("click", async () => {
    if (!payId) return;
    try {
      await callApi(`${API}/${payId}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: document.getElementById("sup-pay-amount").value,
          paid_at: document.getElementById("sup-pay-date").value,
          note: document.getElementById("sup-pay-note").value,
        }),
      });
      msg("Pagesa u regjistrua.");
      await openPay(payId);
      await load();
    } catch (e) {
      msg(e.message || "Pagesa dështoi.");
    }
  });

  window.HotelSuppliers = { load };
})();
