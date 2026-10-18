/** Kontakt mbështetjeje licencë — vetëm nga env (Railway / instalues), jo numra personalë në kod. */

function getLicenseSupportPhoneDisplay() {
  return String(
    process.env.SUPPORT_PHONE || process.env.LICENSE_SUPPORT_PHONE || "",
  ).trim();
}

function getLicenseSupportWhatsAppDigits() {
  return getLicenseSupportPhoneDisplay().replace(/\D/g, "");
}

function getLicenseSupportContactHtml() {
  const phone = getLicenseSupportPhoneDisplay();
  if (phone) {
    return `<p class="phone">WhatsApp / tel: <b>${phone}</b></p>`;
  }
  return '<p class="phone">Kontaktoni mbështetjen përmes <b>revolution-pos.com</b></p>';
}

function getLicenseSupportContactPlain() {
  const phone = getLicenseSupportPhoneDisplay();
  if (phone) return phone;
  return "revolution-pos.com";
}

function buildLicenseWhatsAppActivationUrl(hardwareId, email) {
  const digits = getLicenseSupportWhatsAppDigits();
  const hw = String(hardwareId || "").trim() || "—";
  const em = String(email || "").trim();
  const lines = [
    "Pershendetje Revolution Invest,",
    `ID pajisje per aktivizim: ${hw}`,
    em ? `Email: ${em}` : null,
    "Ju lutem me dergoni kodin e licences. Mund te dergoj edhe foto te ketij ekrani.",
  ].filter(Boolean);
  const text = encodeURIComponent(lines.join("\n"));
  if (digits) return `https://wa.me/${digits}?text=${text}`;
  return `https://revolution-pos.com/?text=${text}`;
}

module.exports = {
  getLicenseSupportPhoneDisplay,
  getLicenseSupportWhatsAppDigits,
  getLicenseSupportContactHtml,
  getLicenseSupportContactPlain,
  buildLicenseWhatsAppActivationUrl,
};
