/** Resend — fatura A4 desktop (RESEND_API_KEY nga env). */

const DEFAULT_INVOICE_FROM_ADDRESS = "noreply@ketujemi.com";



function invoiceFromAddressFromEnv() {

  const raw = String(process.env.EMAIL_FROM || "").trim();

  if (!raw) return DEFAULT_INVOICE_FROM_ADDRESS;

  const inBrackets = raw.match(/<([^>]+)>/);

  let addr = inBrackets ? inBrackets[1].trim() : raw;

  if (!addr.includes("@")) return DEFAULT_INVOICE_FROM_ADDRESS;

  return addr.replace(/@revolutioninvest\.com/gi, "@ketujemi.com");

}



function formatRFC5322DisplayName(name) {

  const n = String(name || "").trim();

  if (!n) return "";

  if (/[\x00-\x1f"\\]/.test(n) || n.includes("@")) {

    return `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  }

  return n;

}



function buildInvoiceA4From(displayName, nameFallback = "Hotel") {

  const label = formatRFC5322DisplayName(displayName) || String(nameFallback || "Hotel").trim();

  const addr = invoiceFromAddressFromEnv();

  return `${label} <${addr}>`;

}



function isEmailConfigured() {

  return Boolean(process.env.RESEND_API_KEY?.trim());

}



async function deliverEmail({ to, subject, text, html, attachments, from }) {

  if (!isEmailConfigured()) {

    throw new Error("Nuk mund të dërgohet email.");

  }

  if (!from || !String(from).trim()) {

    throw new Error("Mungon From për email-in e faturës.");

  }

  const payload = {

    from: String(from).trim(),

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

    throw new Error(`Email: ${detail}`);

  }

  return data;

}



module.exports = { deliverEmail, isEmailConfigured, buildInvoiceA4From };


