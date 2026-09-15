/**
 * Kontabilisti ATK UI — hub + libra zyrtare (admin panel).
 * Varet nga api / escHtml / formatEuro / lexoSesionin në admin.html.
 */
(function () {
  const euro = (n) =>
    typeof formatEuro === "function"
      ? formatEuro(n)
      : `${Number(n || 0).toFixed(2)} €`;
  const esc = (s) =>
    typeof escHtml === "function"
      ? escHtml(s)
      : String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

  function globalRange() {
    const from =
      document.getElementById("kont-global-nga")?.value ||
      document.getElementById("kont-bilanc-nga")?.value ||
      "";
    const to =
      document.getElementById("kont-global-deri")?.value ||
      document.getElementById("kont-bilanc-deri")?.value ||
      "";
    return { from, to };
  }

  function syncHiddenDates(from, to) {
    const pairs = [
      ["kont-global-nga", "kont-global-deri"],
      ["kont-bilanc-nga", "kont-bilanc-deri"],
      ["kont-shitje-nga", "kont-shitje-deri"],
      ["kont-blerje-nga", "kont-blerje-deri"],
      ["kont-shpenzim-nga", "kont-shpenzim-deri"],
    ];
    for (const [a, b] of pairs) {
      const elA = document.getElementById(a);
      const elB = document.getElementById(b);
      if (elA) elA.value = from;
      if (elB) elB.value = to;
    }
    const month = (from || "").slice(0, 7);
    const tvsh = document.getElementById("kont-tvsh-muaji");
    if (tvsh && month) tvsh.value = month;
    const paga = document.getElementById("kont-paga-muaji");
    if (paga && !paga.value && month) paga.value = month;
    const qera = document.getElementById("kont-qera-muaji");
    if (qera && !qera.value && month) qera.value = month;
    const vit = document.getElementById("kont-vit-viti");
    if (vit && !vit.value && from) vit.value = from.slice(0, 4);
  }

  function showHub() {
    document.getElementById("kont-hub")?.removeAttribute("hidden");
    document.querySelectorAll(".kont-sec").forEach((el) => {
      el.hidden = true;
    });
  }

  function showSec(name) {
    document.getElementById("kont-hub")?.setAttribute("hidden", "");
    document.querySelectorAll(".kont-sec").forEach((el) => {
      el.hidden = el.id !== `kont-sec-${name}`;
    });
    loadSec(name).catch((err) => alert(err.message || "Gabim"));
  }

  function declBoxes(obj) {
    return Object.entries(obj || {})
      .map(
        ([k, v]) =>
          `<div class="kont-decl-box"><div class="lbl">${esc(k)}</div><div class="val">${euro(v)}</div></div>`,
      )
      .join("");
  }

  async function loadSalesVat() {
    const { from, to } = globalRange();
    const data = await api(
      "/api/kontabilisti/atk/sales-vat?" + new URLSearchParams({ from, to }),
    );
    const body = document.getElementById("kont-atk-shitje-body");
    const rows = data.rows || [];
    if (!body) return;
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="9" class="purchases-empty">Nuk ka shitje në këtë periudhë</td></tr>';
    } else {
      body.innerHTML = rows
        .map(
          (r) => `<tr>
        <td>${r.nr}</td><td>${esc(r.date)}</td><td>${esc(r.invoice_number || "—")}</td>
        <td>${euro(r.box9)}</td><td>${euro(r.box12)}</td><td>${euro(r.boxK1)}</td>
        <td>${euro(r.box14)}</td><td>${euro(r.boxK2)}</td><td>${euro(r.box30)}</td>
      </tr>`,
        )
        .join("");
    }
    const t = data.totals || {};
    const totEl = document.getElementById("kont-atk-shitje-totals");
    if (totEl) {
      totEl.textContent = `TOTALI · [9]=${euro(t.box9)} · [10c]=${euro(t.box10c)} · [12]=${euro(t.box12)} · [K1]=${euro(t.boxK1)} · [14]=${euro(t.box14)} · [K2]=${euro(t.boxK2)} · [30]=${euro(t.box30)}`;
    }
  }

  async function loadPurchaseVat() {
    const { from, to } = globalRange();
    const data = await api(
      "/api/kontabilisti/atk/purchases-vat?" + new URLSearchParams({ from, to }),
    );
    const body = document.getElementById("kont-atk-blerje-body");
    const rows = data.rows || [];
    if (!body) return;
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="10" class="purchases-empty">Nuk ka blerje / shpenzime</td></tr>';
    } else {
      body.innerHTML = rows
        .map(
          (r) => `<tr>
        <td>${r.nr}</td><td>${esc(r.date)}</td><td>${esc(r.invoice_number || "—")}</td>
        <td>${esc(r.seller_name)}</td><td>${esc(r.seller_fiscal || "—")}</td>
        <td>${euro(r.box43)}</td><td>${euro(r.boxK1)}</td>
        <td>${euro(r.box45)}</td><td>${euro(r.boxK2)}</td><td>${euro(r.box67)}</td>
      </tr>`,
        )
        .join("");
    }
    const t = data.totals || {};
    const totEl = document.getElementById("kont-atk-blerje-totals");
    if (totEl) {
      totEl.textContent = `TOTALI · [43]=${euro(t.box43)} · [K1]=${euro(t.boxK1)} · [67]=${euro(t.box67)}`;
    }
  }

  async function loadQuarterly() {
    const { from, to } = globalRange();
    const qs = new URLSearchParams({ from, to });
    const [sq, pq] = await Promise.all([
      api("/api/kontabilisti/atk/sales-quarterly?" + qs),
      api("/api/kontabilisti/atk/purchases-quarterly?" + qs),
    ]);
    const sb = document.getElementById("kont-atk-sq-body");
    const pb = document.getElementById("kont-atk-pq-body");
    if (sb) {
      const rows = sq.rows || [];
      sb.innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<tr><td>${r.nr}</td><td>${esc(r.date)}</td><td>${esc(r.invoice_number || "—")}</td><td>${euro(r.col_a)}</td><td>${euro(r.col_b)}</td><td>${euro(r.col_c)}</td><td>${euro(r.col_d)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="7" class="purchases-empty">Nuk ka shitje</td></tr>';
    }
    if (pb) {
      const rows = pq.rows || [];
      pb.innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<tr><td>${r.nr}</td><td>${esc(r.date)}</td><td>${esc(r.invoice_number || "—")}</td><td>${esc(r.seller_name)}</td><td>${euro(r.col_a)}</td><td>${euro(r.col_b)}</td><td>${euro(r.col_c)}</td><td>${euro(r.col_g)}</td></tr>`,
            )
            .join("")
        : '<tr><td colspan="8" class="purchases-empty">Nuk ka blerje</td></tr>';
    }
  }

  async function loadDeclaration() {
    const { from, to } = globalRange();
    const data = await api(
      "/api/kontabilisti/atk/vat-declaration?" + new URLSearchParams({ from, to }),
    );
    const grid = document.getElementById("kont-atk-decl-grid");
    if (grid) grid.innerHTML = declBoxes(Object.fromEntries((data.rows || []).map((r) => [r.code, r.amount])));
    const pay = document.getElementById("kont-atk-decl-payable");
    if (pay) {
      const v = Number(data.vat_payable) || 0;
      pay.textContent =
        v >= 0
          ? `TVSH për pagesë: ${euro(v)}`
          : `TVSH për kthim: ${euro(Math.abs(v))}`;
    }
  }

  async function loadPayroll() {
    const ym =
      document.getElementById("kont-paga-muaji")?.value ||
      globalRange().from.slice(0, 7);
    if (!ym) return;
    const data = await api(
      "/api/kontabilisti/atk/payroll?" + new URLSearchParams({ year_month: ym }),
    );
    const body = document.getElementById("kont-paga-body");
    const rows = data.rows || [];
    if (body) {
      body.innerHTML = rows.length
        ? rows
            .map((r) => {
              const tax =
                Number(r.gross_salary) <= 250
                  ? 0
                  : Number(r.gross_salary) <= 450
                    ? (Number(r.gross_salary) - 250) * 0.08
                    : 16 + (Number(r.gross_salary) - 450) * 0.1;
              return `<tr>
            <td>${esc(r.first_name)}</td><td>${esc(r.last_name)}</td><td>${esc(r.individual_number)}</td>
            <td>${euro(r.gross_salary)}</td><td>${euro(r.employee_pension)}</td><td>${euro(r.employer_pension)}</td>
            <td>${euro(tax)}</td>
            <td><button type="button" class="btn btn-ghost btn-sm" data-paga-del="${r.id}">Fshi</button></td>
          </tr>`;
            })
            .join("")
        : '<tr><td colspan="8" class="purchases-empty">Nuk ka paga për këtë muaj</td></tr>';
      body.querySelectorAll("[data-paga-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Fshi këtë rresht?")) return;
          await api("/api/kontabilisti/atk/payroll/" + btn.dataset.pagaDel, {
            method: "DELETE",
          });
          loadPayroll();
        });
      });
    }
    const w = data.withholding || {};
    const grid = document.getElementById("kont-paga-form-grid");
    if (grid) {
      grid.innerHTML = declBoxes({
        "[8] Pagat bruto": w.box8,
        "[9] Tatimi i mbajtur": w.box9,
        "[10] Nr. punëtorëve": w.box10,
        "[11] Deri 250€": w.box11,
        "[12] 250–450€": w.box12,
        "[13] Mbi 450€": w.box13,
        "[18] Kontributet e punëtorit": w.box18,
        "[19] Kontributet e punëdhënësit": w.box19,
        "[20] Kontributet totale": w.box20,
      });
    }
  }

  async function loadRent() {
    const ym =
      document.getElementById("kont-qera-muaji")?.value ||
      globalRange().from.slice(0, 7);
    if (!ym) return;
    const data = await api(
      "/api/kontabilisti/atk/rent?" + new URLSearchParams({ year_month: ym }),
    );
    const body = document.getElementById("kont-qera-body");
    const rows = data.rows || [];
    if (body) {
      body.innerHTML = rows.length
        ? rows
            .map(
              (r) => `<tr>
          <td>${esc(r.nui)}</td><td>${esc(r.party_name)}</td>
          <td>${euro(r.rent_gross)}</td><td>${euro(r.tmb_rent)}</td>
          <td>${euro(r.interest)}</td><td>${euro(r.tmb_other)}</td><td>${euro(r.tmb_total)}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-qera-del="${r.id}">Fshi</button></td>
        </tr>`,
            )
            .join("")
        : '<tr><td colspan="8" class="purchases-empty">Nuk ka qera për këtë muaj</td></tr>';
      body.querySelectorAll("[data-qera-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Fshi?")) return;
          await api("/api/kontabilisti/atk/rent/" + btn.dataset.qeraDel, {
            method: "DELETE",
          });
          loadRent();
        });
      });
    }
    const f = data.form || {};
    const grid = document.getElementById("kont-qera-form-grid");
    if (grid) {
      grid.innerHTML = declBoxes({
        "[8] Interesi": f.box8,
        "[9] Të drejtat pronësore": f.box9,
        "[13] Qiraja bruto": f.box13,
        "[14] TMB mbi qira 9%": f.box14,
        "[12] TMB tjetër 10%": f.box12,
        "[18] TMB total": f.box18,
      });
    }
  }

  async function loadQuarterlyForm() {
    const { from, to } = globalRange();
    const prior = document.getElementById("kont-trem-prior")?.value || "0";
    const data = await api(
      "/api/kontabilisti/atk/quarterly?" +
        new URLSearchParams({ from, to, prior_year_tax: prior }),
    );
    const grid = document.getElementById("kont-trem-grid");
    if (grid) {
      grid.innerHTML = declBoxes({
        "[8] Të ardhurat / 4 (periudha)": data.box8,
        "[9] Shpenzimet": data.box9,
        "[10] Fitimi": data.box10,
        "[11] Kësti 10%": data.box11,
        "[12] 110% viti kaluar / 4": data.box12,
        "[13] Pagesa e këstit": data.box13,
        "[15] Pagesa totale": data.box15,
      });
    }
  }

  async function loadAnnual() {
    const y =
      document.getElementById("kont-vit-viti")?.value ||
      new Date().getFullYear();
    try {
      const st = await api(
        "/api/kontabilisti/atk/opening-stock?" + new URLSearchParams({ year: y }),
      );
      const stockEl = document.getElementById("kont-vit-stok-fillimi");
      if (stockEl && st && st.stock_start != null) stockEl.value = String(st.stock_start);
    } catch (_) { /* ok */ }
    const data = await api(
      "/api/kontabilisti/atk/annual?" + new URLSearchParams({ year: y }),
    );
    const hdr = document.getElementById("kont-vit-header");
    if (hdr) {
      const h = data.header || {};
      const t = data.totals || {};
      hdr.textContent = `${h.bizName || "—"} · NUI ${h.nui || "—"} · ${h.address || ""} · Viti ${data.year} · Fitimi ${euro(t.netProfit)} · Stok fillimi ${euro(t.stockStart)} · Stok fundi ${euro(t.stockEnd)}`;
    }
    const body = document.getElementById("kont-vit-body");
    if (body) {
      body.innerHTML = (data.income_statement || [])
        .map(
          (r) =>
            `<tr><td>${esc(r.label)}</td><td>${esc(r.note)}</td><td>${euro(r.current)}</td><td>${euro(r.prior)}</td></tr>`,
        )
        .join("");
    }
    const cd = document.getElementById("kont-vit-cd");
    if (cd) cd.innerHTML = declBoxes(data.cd_boxes || {});
  }

  async function saveOpeningStock() {
    const y =
      document.getElementById("kont-vit-viti")?.value ||
      new Date().getFullYear();
    const stock_start = Number(document.getElementById("kont-vit-stok-fillimi")?.value || 0);
    await api("/api/kontabilisti/atk/opening-stock", {
      method: "POST",
      body: JSON.stringify({ year: y, stock_start }),
    });
    await loadAnnual();
  }

  async function loadSec(name) {
    if (name === "bilanc" && typeof ngarkoBilancin === "function") await ngarkoBilancin();
    if (name === "shitje-tvsh") await loadSalesVat();
    if (name === "blerje-tvsh") await loadPurchaseVat();
    if (name === "kuartale") await loadQuarterly();
    if (name === "deklarata") await loadDeclaration();
    if (name === "shpenzime" && typeof ngarkoShpenzimet === "function") await ngarkoShpenzimet();
    if (name === "paga") await loadPayroll();
    if (name === "qera") await loadRent();
    if (name === "tremujor") await loadQuarterlyForm();
    if (name === "vjetore") await loadAnnual();
  }

  function exportCsv(kind) {
    const { from, to } = globalRange();
    const map = {
      "sales-vat": "/api/kontabilisti/atk/sales-vat/export.csv",
      "purchases-vat": "/api/kontabilisti/atk/purchases-vat/export.csv",
      "sales-quarterly": "/api/kontabilisti/atk/sales-quarterly/export.csv",
      "purchases-quarterly": "/api/kontabilisti/atk/purchases-quarterly/export.csv",
    };
    const path = map[kind];
    if (!path) return;
    const u = typeof lexoSesionin === "function" ? lexoSesionin() : null;
    const qs = new URLSearchParams({ from, to });
    if (u?.token) qs.set("token", u.token);
    window.open(`${path}?${qs}`, "_blank");
  }

  function exportXlsx(kind) {
    const { from, to } = globalRange();
    const ym =
      document.getElementById("kont-paga-muaji")?.value ||
      document.getElementById("kont-qera-muaji")?.value ||
      (from || "").slice(0, 7);
    const year =
      document.getElementById("kont-vit-viti")?.value ||
      (from || "").slice(0, 4) ||
      new Date().getFullYear();
    const prior = document.getElementById("kont-trem-prior")?.value || "0";
    const map = {
      "sales-vat": "/api/kontabilisti/atk/sales-vat/export.xlsx",
      "purchases-vat": "/api/kontabilisti/atk/purchases-vat/export.xlsx",
      "sales-quarterly": "/api/kontabilisti/atk/sales-quarterly/export.xlsx",
      "purchases-quarterly": "/api/kontabilisti/atk/purchases-quarterly/export.xlsx",
      "vat-declaration": "/api/kontabilisti/atk/vat-declaration/export.xlsx",
      payroll: "/api/kontabilisti/atk/payroll/export.xlsx",
      "payroll-wh": "/api/kontabilisti/atk/payroll/withholding/export.xlsx",
      rent: "/api/kontabilisti/atk/rent/export.xlsx",
      "rent-form": "/api/kontabilisti/atk/rent/form/export.xlsx",
      quarterly: "/api/kontabilisti/atk/quarterly/export.xlsx",
      annual: "/api/kontabilisti/atk/annual/export.xlsx",
    };
    const path = map[kind];
    if (!path) return;
    const u = typeof lexoSesionin === "function" ? lexoSesionin() : null;
    const qs = new URLSearchParams();
    if (kind === "payroll" || kind === "payroll-wh" || kind === "rent" || kind === "rent-form") {
      if (ym) qs.set("year_month", ym);
    } else if (kind === "annual") {
      qs.set("year", String(year));
    } else {
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (kind === "quarterly") qs.set("prior_year_tax", prior);
    }
    if (u?.token) qs.set("token", u.token);
    window.open(`${path}?${qs}`, "_blank");
  }

  function exportPdf(kind) {
    const { from, to } = globalRange();
    const ym =
      document.getElementById("kont-paga-muaji")?.value ||
      document.getElementById("kont-qera-muaji")?.value ||
      (from || "").slice(0, 7);
    const year =
      document.getElementById("kont-vit-viti")?.value ||
      (from || "").slice(0, 4) ||
      new Date().getFullYear();
    const prior = document.getElementById("kont-trem-prior")?.value || "0";
    const map = {
      "vat-declaration": "/api/kontabilisti/atk/vat-declaration/export.pdf",
      "payroll-wh": "/api/kontabilisti/atk/payroll/withholding/export.pdf",
      "rent-form": "/api/kontabilisti/atk/rent/form/export.pdf",
      quarterly: "/api/kontabilisti/atk/quarterly/export.pdf",
      annual: "/api/kontabilisti/atk/annual/export.pdf",
    };
    const path = map[kind];
    if (!path) return;
    const u = typeof lexoSesionin === "function" ? lexoSesionin() : null;
    const qs = new URLSearchParams();
    if (kind === "payroll-wh" || kind === "rent-form") {
      if (ym) qs.set("year_month", ym);
    } else if (kind === "annual") {
      qs.set("year", String(year));
    } else {
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (kind === "quarterly") qs.set("prior_year_tax", prior);
      if (kind === "vat-declaration" && ym) qs.set("month", ym);
    }
    if (u?.token) qs.set("token", u.token);
    window.open(`${path}?${qs}`, "_blank");
  }

  function printSection(kind) {
    const title =
      kind === "vat-declaration"
        ? "Deklarata e TVSH-së"
        : kind === "annual"
          ? "Pasqyra vjetore"
          : kind === "sales-vat"
            ? "Libri i Shitjes TVSH"
            : "Libri i Blerjes TVSH";
    let html = "";
    if (kind === "sales-vat") {
      html = document.getElementById("kont-sec-shitje-tvsh")?.innerHTML || "";
    } else if (kind === "purchases-vat") {
      html = document.getElementById("kont-sec-blerje-tvsh")?.innerHTML || "";
    } else if (kind === "vat-declaration") {
      html = document.getElementById("kont-sec-deklarata")?.innerHTML || "";
    } else if (kind === "annual") {
      html = document.getElementById("kont-sec-vjetore")?.innerHTML || "";
    }
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:Segoe UI,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}
      th{background:#f8fafc;font-size:10px;text-transform:uppercase}button{display:none}</style></head>
      <body><h1>${title}</h1>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  function bind() {
    document.querySelectorAll("[data-kont-sec]").forEach((btn) => {
      btn.addEventListener("click", () => showSec(btn.dataset.kontSec));
    });
    document.querySelectorAll(".kont-sec-back").forEach((btn) => {
      btn.addEventListener("click", showHub);
    });
    document.getElementById("btn-kont-global-filtro")?.addEventListener("click", () => {
      const { from, to } = globalRange();
      syncHiddenDates(from, to);
      if (typeof applyKontPeriod === "function") {
        applyKontPeriod("lire", { reload: true });
      }
    });
    document.querySelectorAll("[data-atk-csv]").forEach((btn) => {
      btn.addEventListener("click", () => exportCsv(btn.dataset.atkCsv));
    });
    document.querySelectorAll("[data-atk-xlsx]").forEach((btn) => {
      btn.addEventListener("click", () => exportXlsx(btn.dataset.atkXlsx));
    });
    document.querySelectorAll("[data-atk-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => exportPdf(btn.dataset.atkPdf));
    });
    document.querySelectorAll("[data-atk-print]").forEach((btn) => {
      btn.addEventListener("click", () => printSection(btn.dataset.atkPrint));
    });
    document.getElementById("btn-kont-paga-load")?.addEventListener("click", () => loadPayroll());
    document.getElementById("btn-kont-qera-load")?.addEventListener("click", () => loadRent());
    document.getElementById("btn-kont-trem-load")?.addEventListener("click", () => loadQuarterlyForm());
    document.getElementById("btn-kont-vit-load")?.addEventListener("click", () => loadAnnual());
    document.getElementById("btn-kont-vit-stok-save")?.addEventListener("click", () => {
      saveOpeningStock().catch((e) => alert(e.message || "Gabim"));
    });

    document.getElementById("btn-kont-paga-ri")?.addEventListener("click", () => {
      document.getElementById("kont-paga-id").value = "";
      document.getElementById("kont-paga-emri").value = "";
      document.getElementById("kont-paga-mbiemri").value = "";
      document.getElementById("kont-paga-nui").value = "";
      document.getElementById("kont-paga-bruto").value = "";
      document.getElementById("kont-paga-modal").hidden = false;
      document.getElementById("kont-paga-modal-backdrop").hidden = false;
    });
    document.getElementById("kont-paga-cancel")?.addEventListener("click", () => {
      document.getElementById("kont-paga-modal").hidden = true;
      document.getElementById("kont-paga-modal-backdrop").hidden = true;
    });
    document.getElementById("kont-paga-save")?.addEventListener("click", async () => {
      const ym = document.getElementById("kont-paga-muaji")?.value;
      if (!ym) return alert("Zgjidhni muajin");
      await api("/api/kontabilisti/atk/payroll", {
        method: "POST",
        body: JSON.stringify({
          year_month: ym,
          first_name: document.getElementById("kont-paga-emri").value,
          last_name: document.getElementById("kont-paga-mbiemri").value,
          individual_number: document.getElementById("kont-paga-nui").value,
          gross_salary: document.getElementById("kont-paga-bruto").value,
        }),
      });
      document.getElementById("kont-paga-modal").hidden = true;
      document.getElementById("kont-paga-modal-backdrop").hidden = true;
      loadPayroll();
    });

    document.getElementById("btn-kont-qera-ri")?.addEventListener("click", () => {
      document.getElementById("kont-qera-id").value = "";
      ["kont-qera-nui", "kont-qera-emri", "kont-qera-bruto"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      document.getElementById("kont-qera-interes").value = "0";
      document.getElementById("kont-qera-m2").value = "0";
      document.getElementById("kont-qera-modal").hidden = false;
      document.getElementById("kont-qera-modal-backdrop").hidden = false;
    });
    document.getElementById("kont-qera-cancel")?.addEventListener("click", () => {
      document.getElementById("kont-qera-modal").hidden = true;
      document.getElementById("kont-qera-modal-backdrop").hidden = true;
    });
    document.getElementById("kont-qera-save")?.addEventListener("click", async () => {
      const ym = document.getElementById("kont-qera-muaji")?.value;
      if (!ym) return alert("Zgjidhni muajin");
      await api("/api/kontabilisti/atk/rent", {
        method: "POST",
        body: JSON.stringify({
          year_month: ym,
          nui: document.getElementById("kont-qera-nui").value,
          party_name: document.getElementById("kont-qera-emri").value,
          rent_gross: document.getElementById("kont-qera-bruto").value,
          interest: document.getElementById("kont-qera-interes").value,
          area_m2: document.getElementById("kont-qera-m2").value,
          monthly_rent: document.getElementById("kont-qera-bruto").value,
        }),
      });
      document.getElementById("kont-qera-modal").hidden = true;
      document.getElementById("kont-qera-modal-backdrop").hidden = true;
      loadRent();
    });
  }

  window.KontabilistiAtk = {
    syncHiddenDates,
    showHub,
    showSec,
    loadSec,
    globalRange,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
