/** Dërgim email transaksional (Resend). */

const DEFAULT_EMAIL_FROM = "Revolution POS <noreply@ketujemi.com>";
const { getPublicAppOrigin, getSupportPhone } = require("../lib/publicOrigin");

function resolveEmailFrom() {
  const raw = process.env.EMAIL_FROM?.trim();
  if (!raw) return DEFAULT_EMAIL_FROM;
  return raw.replace(/@revolutioninvest\.com/gi, "@ketujemi.com");
}

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

async function deliverEmail({ to, subject, text, html, attachments }) {
  if (!isEmailConfigured()) {
    throw new Error(
      "Emaili nuk është i konfiguruar. Vendosni RESEND_API_KEY në Railway.",
    );
  }

  const payload = {
    from: resolveEmailFrom(),
    to: [String(to).trim().toLowerCase()],
    subject,
    text,
    html,
  };
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments.map((a) => ({
      filename: String(a.filename || "attachment.pdf"),
      content: String(a.content || ""),
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.message || data.error || `HTTP ${res.status}`;
    throw new Error(`Email send failed: ${detail}`);
  }
  return data;
}

async function sendOwnerPasswordResetEmail({ to, code }) {
  const subject = "Rivendos fjalëkalimin — Revolution Security";
  const text = [
    "Kërkesë për rivendosje fjalëkalimi — Paneli i pronarit (Revolution Security).",
    "",
    `Kodi juaj 6-shifror: ${code}`,
    "",
    "Hapni panelin e pronarit → Harrove fjalëkalimin → vendosni KODIN (jo emailin) + fjalëkalimin e ri.",
    "Kodi skadon pas 15 minutash.",
    "Nëse nuk e keni kërkuar ju, injoroni këtë email.",
  ].join("\n");

  const html = `
    <p>Kodi për fjalëkalim të ri — <strong>Revolution Security</strong> (paneli i pronarit):</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
    <p>Te fusha <strong>«Kodi nga email»</strong> vendosni vetëm këto 6 shifra — jo adresën e emailit.</p>
    <p style="color:#666;font-size:13px">Skadon pas 15 minutash.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

/** Kod emergjence për hyrje kamarieri (Harruat PIN?) — vetëm te email i pronarit. */
async function sendOwnerEmergencyCodeEmail({
  to,
  ownerName,
  clientName,
  code,
  waiterName,
  validForDate,
}) {
  const biz = String(clientName || "Lokali juaj").trim();
  const who = String(waiterName || "").trim();
  const subject = `Kod emergjence PIN kamarier — ${biz}`;
  const text = [
    ownerName ? `Përshëndetje ${ownerName},` : "Përshëndetje,",
    "",
    `Një kamarier në «${biz}» kërkoi kod emergjence sepse harroi PIN-in.`,
    who ? `Kamarieri: ${who}` : null,
    "",
    `Kodi emergjence (6 shifra): ${code}`,
    validForDate ? `I vlefshëm për datën: ${validForDate}` : null,
    "",
    "Jepjani këtë kod kamarierit që të hyjë në POS.",
    "Mos e ndani publikisht. Nëse nuk e keni kërkuar ju, kontaktoni Revolution Invest.",
  ]
    .filter((x) => x != null)
    .join("\n");

  const html = `
    <p>${ownerName ? `Përshëndetje <strong>${ownerName}</strong>,` : "Përshëndetje,"}</p>
    <p>Një kamarier në <strong>${biz}</strong> kërkoi kod emergjence sepse harroi PIN-in.</p>
    ${who ? `<p>Kamarieri: <strong>${who}</strong></p>` : ""}
    <p style="font-size:26px;font-weight:bold;letter-spacing:0.35em;margin:20px 0;font-family:ui-monospace,monospace">${code}</p>
    ${validForDate ? `<p style="color:#666;font-size:13px">I vlefshëm për datën: ${validForDate}</p>` : ""}
    <p>Jepjani këtë kod kamarierit që të hyjë në POS. Mos e ndani publikisht.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

function resolveSupportPhone() {
  return getSupportPhone();
}

function resolveAdminNotifyEmail() {
  return (
    process.env.ADMIN_NOTIFY_EMAIL?.trim() ||
    process.env.SUPER_ADMIN_NOTIFY_EMAIL?.trim() ||
    "novelto22@gmail.com"
  ).toLowerCase();
}

async function sendTrialExpiry7DayEmail({ to, clientName, expiryDate }) {
  const subject = "Pakoja juaj skadon së shpejti — Revolution Invest POS";
  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    `Pakoja juaj skadon më ${expiryDate}. Kontaktoni Revolution Invest POS për të vazhduar.`,
    "",
    `Telefon: ${resolveSupportPhone()}`,
  ].join("\n");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${clientName}</strong>,` : "Përshëndetje,"}</p>
    <p>Pakoja juaj skadon më <strong>${expiryDate}</strong>.</p>
    <p>Kontaktoni <strong>Revolution Invest POS</strong> për të vazhduar shërbimin.</p>
    <p style="margin-top:16px">Telefon: <strong>${resolveSupportPhone()}</strong></p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendTrialExpiry1DayEmail({ to, clientName, expiryDate }) {
  const subject = "Kujtesë: pakoja skadon nesër — Revolution Invest POS";
  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    `Pakoja juaj skadon më ${expiryDate} (nesër). Kontaktoni Revolution Invest POS për të vazhduar.`,
    "",
    `Telefon: ${resolveSupportPhone()}`,
  ].join("\n");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${clientName}</strong>,` : "Përshëndetje,"}</p>
    <p><strong>Kujtesë:</strong> pakoja juaj skadon më <strong>${expiryDate}</strong> (nesër).</p>
    <p>Kontaktoni <strong>Revolution Invest POS</strong> për të vazhduar.</p>
    <p style="margin-top:16px">Telefon: <strong>${resolveSupportPhone()}</strong></p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendTrialExpiredEmail({ to, clientName }) {
  const phone = resolveSupportPhone();
  const subject = "Pakoja juaj ka skaduar — Revolution Invest POS";
  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    `Pakoja juaj ka skaduar. Kontaktoni ${phone}`,
  ].join("\n");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${clientName}</strong>,` : "Përshëndetje,"}</p>
    <p>Pakoja juaj <strong>ka skaduar</strong>.</p>
    <p>Kontaktoni <strong>${phone}</strong> për të riaktivizuar shërbimin.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

function escapeHtmlEmail(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendAdminTrialExpiryAlertEmail({ clients }) {
  const to = resolveAdminNotifyEmail();
  const rows = (clients || []).map(c => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #334155">${escapeHtmlEmail(c.client_name) || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #334155">${escapeHtmlEmail(c.phone) || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #334155">${escapeHtmlEmail(c.package_label) || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #334155">${escapeHtmlEmail(c.expiry_date) || "—"}</td>
    </tr>`).join("");

  const textLines = (clients || []).map(c =>
    `- ${c.client_name} | ${c.phone || "—"} | ${c.package_label} | skadon ${c.expiry_date}`,
  );

  const subject = `Trial skadon së shpejti — ${clients.length} klient(ë)`;
  const text = [
    "Klientët me trial që skadon për 7 ditë:",
    "",
    ...textLines,
  ].join("\n");

  const html = `
    <p>Klientët me <strong>trial që skadon për 7 ditë</strong>:</p>
    <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px">
      <thead>
        <tr style="background:#1e293b;color:#e2e8f0">
          <th style="padding:8px;text-align:left">Klienti</th>
          <th style="padding:8px;text-align:left">Telefoni</th>
          <th style="padding:8px;text-align:left">Pakoja</th>
          <th style="padding:8px;text-align:left">Skadimi</th>
        </tr>
      </thead>
      <tbody>${rows || "<tr><td colspan=\"4\">—</td></tr>"}</tbody>
    </table>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendOwnerInviteEmail({ to, emri, clientName, inviteUrl }) {
  const subject = "Ftesë — Paneli i pronarit Revolution POS";
  const text = [
    `Përshëndetje ${emri || ""},`.trim(),
    "",
    clientName ? `Jeni ftuar si pronar i ${clientName}.` : "Jeni ftuar si pronar në Revolution POS.",
    "",
    "Klikoni linkun për të vendosur fjalëkalimin dhe aktivizuar llogarinë:",
    inviteUrl,
    "",
    "Linku skadon pas 48 orësh.",
  ].join("\n");

  const html = `
    <p>Përshëndetje <strong>${emri || "pronar"}</strong>,</p>
    ${clientName ? `<p>Jeni ftuar si pronar i <strong>${clientName}</strong>.</p>` : ""}
    <p><a href="${inviteUrl}">Aktivizo llogarinë dhe vendos fjalëkalimin</a></p>
    <p style="color:#666;font-size:13px">Linku skadon pas 48 orësh.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendStockLowAlertEmail({ to, clientName, itemName, quantity, threshold }) {
  const q = Number(quantity);
  const subject =
    q <= 0
      ? `Stoku mbaroi: ${itemName} — Revolution POS`
      : `Stoku i ulët: ${itemName} — Revolution POS`;
  const statusLine =
    q <= 0
      ? `Artikulli "${itemName}" ka arritur në 0 copë dhe u fsheh nga menuja.`
      : `Artikulli "${itemName}" ka vetëm ${q} copë (prag: ${threshold}).`;

  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    statusLine,
    "",
    "Hyni te paneli i pronarit → Stoku për të rimbushur ose rregulluar stokun.",
  ].join("\n");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${clientName}</strong>,` : "Përshëndetje,"}</p>
    <p>${statusLine}</p>
    <p style="margin-top:16px">Hyni te paneli i pronarit → <strong>Stoku</strong> për të rimbushur stokun.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendDailyAiReportEmail({ to, clientName, reportDate, summaryText, payload }) {
  const { AI_ENABLED } = require("../lib/aiConfig");
  if (!AI_ENABLED) return { skipped: true, reason: "ai_disabled" };

  const revenue = Number(payload?.sales?.total_revenue || 0);
  const orders = Number(payload?.sales?.order_count || 0);
  const profit = Number(payload?.profit?.profit ?? revenue);
  const subject = `Raporti AI ditor — ${reportDate} — Revolution POS`;
  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    `Raporti AI për ${reportDate}:`,
    "",
    summaryText || "—",
    "",
    `Shitje: ${revenue.toFixed(2)} € (${orders} porosi)`,
    `Fitim i vlerësuar: ${profit.toFixed(2)} €`,
    "",
    "Hapni panelin e pronarit → Raporte AI për detaje.",
  ].join("\n");

  const topItems = (payload?.top_items || [])
    .map(i => `<li>${escapeHtmlEmail(i.name)} — ${Number(i.quantity)} copë, ${Number(i.revenue).toFixed(2)} €</li>`)
    .join("");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${escapeHtmlEmail(clientName)}</strong>,` : "Përshëndetje,"}</p>
    <p><strong>Raporti AI ditor — ${escapeHtmlEmail(reportDate)}</strong></p>
    <p style="white-space:pre-wrap;line-height:1.5">${escapeHtmlEmail(summaryText || "—")}</p>
    <p style="margin-top:16px">
      <strong>Shitje:</strong> ${revenue.toFixed(2)} € · ${orders} porosi<br>
      <strong>Fitim i vlerësuar:</strong> ${profit.toFixed(2)} €
    </p>
    ${topItems ? `<ul style="margin-top:12px">${topItems}</ul>` : ""}
    <p style="margin-top:16px;color:#666;font-size:13px">Hapni panelin e pronarit → Raporte AI për historikun e plotë.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendShiftCloseReportEmail({
  to,
  clientName,
  waiterName,
  shiftDate,
  totalSales,
  orderCount,
  cashTotal,
  cardTotal,
  lowStockItems,
}) {
  const restaurant = String(clientName || "Lokal").trim() || "Lokal";
  const dateLabel = String(shiftDate || "").trim() || "—";
  const total = Number(totalSales) || 0;
  const orders = Number(orderCount) || 0;
  const cash = Number(cashTotal) || 0;
  const card = Number(cardTotal) || 0;
  const low = Array.isArray(lowStockItems) ? lowStockItems : [];

  const subject = `Raporti ditor - ${restaurant} - ${dateLabel}`;

  const lowStockLines = low.map(item => {
    const name = String(item?.name || "Artikull").trim() || "Artikull";
    const qty = Number(item?.stock_qty ?? item?.quantity ?? 0);
    return `- ${name}: ${qty} copë`;
  });

  const textParts = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    `Kamarieri: ${String(waiterName || "—").trim() || "—"}`,
    `Data: ${dateLabel}`,
    `Pazari total: ${total.toFixed(2)} €`,
    `Porosi: ${orders}`,
    `Cash: ${cash.toFixed(2)} € | Kartë: ${card.toFixed(2)} €`,
  ];
  if (lowStockLines.length) {
    textParts.push("", "Stoku i ulët:", ...lowStockLines);
  }
  const text = textParts.join("\n");

  const lowStockHtml = lowStockLines.length
    ? `<p style="margin-top:16px"><strong>Stoku i ulët:</strong></p>
       <ul>${low
         .map(item => {
           const name = escapeHtmlEmail(String(item?.name || "Artikull").trim() || "Artikull");
           const qty = Number(item?.stock_qty ?? item?.quantity ?? 0);
           return `<li>${name}: ${qty} copë</li>`;
         })
         .join("")}</ul>`
    : "";

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${escapeHtmlEmail(clientName)}</strong>,` : "Përshëndetje,"}</p>
    <p>
      <strong>Kamarieri:</strong> ${escapeHtmlEmail(String(waiterName || "—").trim() || "—")}<br>
      <strong>Data:</strong> ${escapeHtmlEmail(dateLabel)}<br>
      <strong>Pazari total:</strong> ${total.toFixed(2)} €<br>
      <strong>Porosi:</strong> ${orders}<br>
      <strong>Cash:</strong> ${cash.toFixed(2)} € | <strong>Kartë:</strong> ${card.toFixed(2)} €
    </p>
    ${lowStockHtml}
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendSupplySuggestionEmail({
  to,
  clientName,
  supplierName,
  suggestionDate,
  summaryText,
  items,
}) {
  const subject = `Porosi furnizimi — ${suggestionDate} — ${clientName || "Revolution POS"}`;
  const lines = (items || []).map(
    i =>
      `- ${i.name}: ${Number(i.order_quantity).toFixed(3).replace(/\.?0+$/, "")} ${i.unit} (stoku: ${Number(i.current_quantity).toFixed(3)} / min: ${Number(i.min_quantity).toFixed(3)})`,
  );

  const text = [
    supplierName ? `Përshëndetje ${supplierName},` : "Përshëndetje,",
    "",
    clientName
      ? `${clientName} ju dërgon listën e përbërësve për furnizim (${suggestionDate}):`
      : `Listë furnizimi (${suggestionDate}):`,
    "",
    summaryText || "",
    "",
    ...lines,
    "",
    "Ju lutemi konfirmoni porosinë dhe afatin e dorëzimit.",
    "",
    "Revolution POS — ketujemi.com",
  ].join("\n");

  const htmlItems = (items || [])
    .map(
      i => `<tr>
        <td>${String(i.name).replace(/</g, "&lt;")}</td>
        <td style="text-align:right">${Number(i.order_quantity).toFixed(2)} ${i.unit}</td>
        <td style="text-align:right">${Number(i.current_quantity).toFixed(2)}</td>
        <td style="text-align:right">${Number(i.min_quantity).toFixed(2)}</td>
      </tr>`,
    )
    .join("");

  const html = `
    <p>${supplierName ? `Përshëndetje <strong>${supplierName}</strong>,` : "Përshëndetje,"}</p>
    <p>${clientName ? `<strong>${clientName}</strong> kërkon furnizim për datën <strong>${suggestionDate}</strong>:` : `Porosi furnizimi për ${suggestionDate}:`}</p>
    ${summaryText ? `<p style="margin:12px 0">${summaryText.replace(/</g, "&lt;")}</p>` : ""}
    <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:14px">
      <thead><tr><th>Përbërësi</th><th>Porosit</th><th>Stoku</th><th>Minimum</th></tr></thead>
      <tbody>${htmlItems}</tbody>
    </table>
    <p style="margin-top:16px">Ju lutemi konfirmoni porosinë dhe afatin e dorëzimit.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendLowStockCriticalEmail({ to, clientName, items, analysisText }) {
  const { AI_ENABLED } = require("../lib/aiConfig");
  if (!AI_ENABLED) return { skipped: true, reason: "ai_disabled" };

  const list = (items || [])
    .map(
      (i) =>
        `- ${i.name}: stok ${i.current_quantity} ${i.unit || ""}` +
        (i.recommend_order ? ` → porositi ${i.recommend_order}` : ""),
    )
    .join("\n");

  const subject = `⚠ Stok kritik — ${clientName || "Lokali"} — Revolution POS`;
  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    "Produktet kritike po mbarojnë:",
    list || "—",
    "",
    analysisText || "",
    "",
    "Hapni panelin e pronarit → AI → Parashikim stoku.",
  ].join("\n");

  const htmlItems = (items || [])
    .map(
      (i) =>
        `<li><strong>${escapeHtmlEmail(i.name)}</strong> — ${Number(i.current_quantity)} ${escapeHtmlEmail(i.unit || "")}` +
        (i.recommend_order ? ` · porositi <strong>${Number(i.recommend_order)}</strong>` : "") +
        `</li>`,
    )
    .join("");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${escapeHtmlEmail(clientName)}</strong>,` : "Përshëndetje,"}</p>
    <p><strong>Alert stoku kritik</strong></p>
    <ul>${htmlItems}</ul>
    ${analysisText ? `<p style="white-space:pre-wrap;margin-top:12px">${escapeHtmlEmail(analysisText)}</p>` : ""}
    <p style="margin-top:16px;color:#666;font-size:13px">Paneli i pronarit → AI → Parashikim stoku.</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

async function sendWeeklyAiReportEmail({ to, clientName, weekStart, weekEnd, summaryText, payload }) {
  const { AI_ENABLED } = require("../lib/aiConfig");
  if (!AI_ENABLED) return { skipped: true, reason: "ai_disabled" };

  const revenue = Number(payload?.this_week?.total || 0);
  const prev = Number(payload?.prev_week?.total || 0);
  const subject = `Raporti AI javor — ${weekStart} → ${weekEnd} — Revolution POS`;
  const text = [
    clientName ? `Përshëndetje ${clientName},` : "Përshëndetje,",
    "",
    `Raporti javor ${weekStart} – ${weekEnd}:`,
    "",
    summaryText || "—",
    "",
    `Shitje këtë javë: ${revenue.toFixed(2)} €`,
    `Java e kaluar: ${prev.toFixed(2)} €`,
    "",
    "Hapni panelin e pronarit → Raporte AI / AI për historikun.",
  ].join("\n");

  const html = `
    <p>${clientName ? `Përshëndetje <strong>${escapeHtmlEmail(clientName)}</strong>,` : "Përshëndetje,"}</p>
    <p><strong>Raporti AI javor</strong> (${escapeHtmlEmail(weekStart)} – ${escapeHtmlEmail(weekEnd)})</p>
    <p style="white-space:pre-wrap;line-height:1.5">${escapeHtmlEmail(summaryText || "—")}</p>
    <p style="margin-top:16px">
      <strong>Kjo javë:</strong> ${revenue.toFixed(2)} €<br>
      <strong>Java e kaluar:</strong> ${prev.toFixed(2)} €
    </p>
  `;

  return deliverEmail({ to, subject, text, html });
}

/**
 * Njoftim PRONARIT: POS/cloud është offline (12/24/36/48 orë).
 * Paralajmërim ATK — pas 48h rrezik kontrolli.
 */
async function sendOwnerClientOfflineEmail({
  to,
  clientName,
  hoursOffline,
  milestoneHours,
  lastSeenAt,
  atkWarning,
}) {
  if (!to) throw new Error("Mungon email i pronarit.");
  const name = clientName || "Pronar";
  const hours = Math.round(Number(hoursOffline) || Number(milestoneHours) || 0);
  const support = resolveSupportPhone();
  const seenLabel = lastSeenAt
    ? new Date(lastSeenAt).toLocaleString("sq-AL", { timeZone: "Europe/Belgrade" })
    : "i panjohur";

  const subject = atkWarning
    ? `⚠️ URGJENT: POS offline >48h — rrezik kontrolli ATK — ${name}`
    : `Paralajmërim: POS offline ${milestoneHours}h — ${name}`;

  const text = [
    `Përshëndetje ${name},`,
    "",
    `Sistemi juaj Revolution POS është offline prej rreth ${hours} orësh.`,
    `Lidhja e fundit me cloud: ${seenLabel}`,
    "",
    atkWarning
      ? "KUJTESË E RËNDËSISHME: Keni kaluar 48 orë offline. ATK mund të vijë për kontroll nëse sistemi fiskal / POS nuk po funksionon online. Rilidhni internetin dhe hapni programin sa më shpejt."
      : `Mund të jeni offline deri në 48 orë. Ky është njoftimi i ${milestoneHours} orëve. Pas 48 orësh ATK mund të vijë për kontroll nëse sistemi nuk funksionon. Rilidhni internetin dhe hapni programin.`,
    "",
    `Nëse keni nevojë për ndihmë: ${support}`,
    "",
    "Revolution Invest POS",
  ].join("\n");

  const html = `
    <p>Përshëndetje <strong>${escapeHtmlEmail(name)}</strong>,</p>
    <p>Sistemi juaj <strong>Revolution POS</strong> është <strong>offline</strong> prej rreth <strong>${hours} orësh</strong>.</p>
    <p>Lidhja e fundit me cloud: <code>${escapeHtmlEmail(seenLabel)}</code></p>
    ${
      atkWarning
        ? `<p style="margin-top:16px;padding:12px;background:#7f1d1d;color:#fecaca;border-radius:8px">
            <strong>URGJENT:</strong> Keni kaluar <strong>48 orë</strong> offline.
            <strong>ATK mund të vijë për kontroll</strong> nëse sistemi fiskal / POS nuk po funksionon online.
            Rilidhni internetin dhe hapni programin sa më shpejt.
          </p>`
        : `<p style="margin-top:16px;padding:12px;background:#78350f;color:#fde68a;border-radius:8px">
            <strong>Paralajmërim:</strong> Mund të jeni offline deri në <strong>48 orë</strong>
            (ky njoftim: ${milestoneHours}h). Pas 48 orësh
            <strong>ATK mund të vijë për kontroll</strong> nëse sistemi nuk funksionon.
            Rilidhni internetin dhe hapni programin.
          </p>`
    }
    <p style="margin-top:16px">Nëse keni nevojë për ndihmë: <strong>${escapeHtmlEmail(support)}</strong></p>
    <p style="color:#64748b;font-size:13px">Revolution Invest POS</p>
  `;

  return deliverEmail({ to, subject, text, html });
}

/** @deprecated përdor sendOwnerClientOfflineEmail — mbajtur për kompatibilitet */
async function sendAdminClientOfflineEmail(opts) {
  return sendOwnerClientOfflineEmail({
    ...opts,
    to: opts.to || resolveAdminNotifyEmail(),
  });
}

/** Njoftim sigurie KAFENE → Naseri (from sistemi, jo inbox personal). */
async function sendKafeneSecurityAlertEmail({
  to,
  type,
  hardwareId,
  count24h,
  urgent,
  attemptKeyHash,
  appVersion,
  hostname,
  platform,
  buildFingerprint,
  watermarkOk,
  message,
  at,
}) {
  const dest = String(to || "revolutioninvest05@gmail.com").trim().toLowerCase();
  const urgentTag = urgent ? "URGJENT — " : "";
  const typeLabel =
    type === "license_activate_urgent"
      ? "Tentativë thyerjeje licence (>3 / 24h)"
      : type === "license_activate_failed"
        ? "Licenca dështoi (çelës gabim / HW)"
        : type === "devtools_attempt"
          ? "DevTools i bllokuar"
          : String(type || "Alert");

  const subject = `${urgentTag}KAFENE Siguri: ${typeLabel} — ${hardwareId || "?"}`;
  const lines = [
    "Sistemi automatik KAFENE — njoftim sigurie",
    "",
    `Lloji: ${typeLabel}`,
    `Hardware ID: ${hardwareId || "—"}`,
    `Koha: ${at || new Date().toISOString()}`,
    `Tentativa (24h): ${Number(count24h) || 0}`,
    urgent ? "Niveli: URGJENT" : "Niveli: normal",
    attemptKeyHash ? `Hash i kodit të provuar: ${attemptKeyHash}` : null,
    appVersion ? `Version: ${appVersion}` : null,
    hostname ? `Hostname: ${hostname}` : null,
    platform ? `Platform: ${platform}` : null,
    buildFingerprint ? `Build fingerprint: ${buildFingerprint}` : null,
    `Watermark OK: ${watermarkOk === false ? "JO" : "PO"}`,
    message ? `Mesazh: ${message}` : null,
    "",
    "Ky email dërgohet automatikisht nga Revolution POS — jo nga një person.",
  ].filter((x) => x != null);

  const text = lines.join("\n");
  const html = `<pre style="font-family:ui-monospace,monospace;font-size:13px;line-height:1.45">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;

  return deliverEmail({ to: dest, subject, text, html });
}

module.exports = {
  isEmailConfigured,
  deliverEmail,
  resolveSupportPhone,
  resolveAdminNotifyEmail,
  sendOwnerPasswordResetEmail,
  sendOwnerEmergencyCodeEmail,
  sendOwnerInviteEmail,
  sendTrialExpiry7DayEmail,
  sendTrialExpiry1DayEmail,
  sendTrialExpiredEmail,
  sendAdminTrialExpiryAlertEmail,
  sendStockLowAlertEmail,
  sendDailyAiReportEmail,
  sendShiftCloseReportEmail,
  sendSupplySuggestionEmail,
  sendLowStockCriticalEmail,
  sendWeeklyAiReportEmail,
  sendOwnerClientOfflineEmail,
  sendAdminClientOfflineEmail,
  sendKafeneSecurityAlertEmail,
};
