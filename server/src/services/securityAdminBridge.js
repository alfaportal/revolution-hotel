/**
 * Bridge Master Admin → SecureTrack Super Admin API
 * (klientë/licenca Security në Supabase të veçantë).
 *
 * Auth: Master Admin tashmë është i autentikuar me JWT (super_admin) te /api/super/*.
 * Bridge-i server→server përdor të njëjtin secret të përbashkët me SecureTrack
 * (jo secret të veçantë / të ndryshëm nga paneli).
 */
const {
  normalizeProductLine,
} = require("../utils/productLine");
const {
  SECURITY_SECTORS,
  SECURITY_VEPRIMTARI,
  normalizeVeprimtari,
  labelForVeprimtari,
  sectorForVeprimtari,
} = require("../utils/securityVeprimtari");

/** I njëjti default si SecureTrack server/routes/admin.js */
const SHARED_MASTER_ADMIN_SECRET = "naser-security-2026";

function securityUpstream() {
  return String(
    process.env.SECURITY_UPSTREAM_URL
      || process.env.SECURITY_CLOUD_URL
      || "https://revolution-security-production.up.railway.app",
  )
    .trim()
    .replace(/\/$/, "");
}

/**
 * Secret i përbashkët Master Admin ↔ SecureTrack.
 * Mos përdor SUPER_ADMIN_SECRET të POS (shpesh bosh ose i ndryshëm) — shkakton 401.
 */
function securityAdminSecret() {
  return String(
    process.env.SECURITY_ADMIN_SECRET
      || process.env.MASTER_ADMIN_BRIDGE_SECRET
      || process.env.SECURITY_SUPER_ADMIN_SECRET
      || SHARED_MASTER_ADMIN_SECRET,
  ).trim();
}

async function securityAdminFetch(path, { method = "GET", body } = {}) {
  const secret = securityAdminSecret();
  const url = `${securityUpstream()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": secret,
      "x-master-admin-bridge": "1",
      "x-revolution-master-admin": "1",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data.gabim || `Security Admin HTTP ${res.status}`;
    const err = new Error(
      /unauthorized|secret/i.test(raw)
        ? "Security bridge: secret i panjohur. Vendos SECURITY_ADMIN_SECRET të njëjtë në POS dhe SecureTrack (default i përbashkët: naser-security-2026)."
        : raw,
    );
    err.status = res.status;
    err.code = data.code || "SECURITY_BRIDGE";
    throw err;
  }
  return data;
}

function mapSecurityClient(c) {
  const veprimtari = normalizeVeprimtari(c.veprimtari);
  const sector = sectorForVeprimtari(veprimtari);
  return {
    id: c.id,
    emri: c.emri,
    tipi: veprimtari,
    tipi_label: labelForVeprimtari(veprimtari),
    package_tier: null,
    package_label: "Security",
    package_contents: "",
    status: "aktiv",
    sales_today: 0,
    email: c.email || "",
    telefoni: c.telefon || c.telefoni || "",
    adresa: c.adresa || "",
    icon: "🛡️",
    sector_num: sector.num,
    sector_id: sector.id,
    product_line: "security",
    veprimtari,
    source: "securetrack",
  };
}

function emptySecuritySectors() {
  return SECURITY_SECTORS.map((s) => ({
    num: s.num,
    id: s.id,
    label: s.label,
    tipet: s.tipet,
    keywords: s.keywords || [],
    clients: [],
    count: 0,
  }));
}

async function getSecurityClientsGrouped() {
  try {
    const data = await securityAdminFetch("/api/admin/clients");
    const clients = (data.clients || []).map(mapSecurityClient);
    const sectors = emptySecuritySectors();
    const byId = new Map(sectors.map((s) => [s.id, s]));
    for (const c of clients) {
      const bucket = byId.get(c.sector_id) || byId.get("sec_tjeter");
      bucket.clients.push(c);
      bucket.count = bucket.clients.length;
    }
    return {
      sectors,
      groups: sectors,
      total: clients.length,
      product_line: "security",
      source: "securetrack",
      veprimtari_options: SECURITY_VEPRIMTARI,
    };
  } catch (e) {
    return {
      sectors: emptySecuritySectors(),
      groups: emptySecuritySectors(),
      total: 0,
      product_line: "security",
      source: "securetrack",
      bridge_error: e.message,
      veprimtari_options: SECURITY_VEPRIMTARI,
    };
  }
}

async function getSecurityLicensesView() {
  try {
    const data = await securityAdminFetch("/api/admin/licenses");
    const licenses = (data.licenses || []).map((l) => ({
      id: l.id,
      client_id: l.client_id || l.clients?.id,
      client_name: l.clients?.emri || "—",
      device_id: l.hardware_id || "",
      hardware_id: l.hardware_id || "",
      license_key: l.license_key || l.celesi || "",
      expires_at: l.expires_at || null,
      statusi: l.status === "active" ? "aktive"
        : l.status === "revoked" ? "revokuar"
          : l.status === "suspended" ? "pezulluar"
            : l.status || "—",
      activated_at: l.created_at,
      last_seen_at: null,
      product_line: "security",
      source: "securetrack",
      raw_status: l.status,
    }));
    return { licenses, product_line: "security", source: "securetrack" };
  } catch (e) {
    return { licenses: [], product_line: "security", bridge_error: e.message };
  }
}

async function getSecurityOverview() {
  const [clientsWrap, licWrap] = await Promise.all([
    getSecurityClientsGrouped(),
    getSecurityLicensesView(),
  ]);
  const licenses = licWrap.licenses || [];
  const activeLic = licenses.filter((l) => l.statusi === "aktive").length;
  const trial = 0;
  return {
    active_clients: clientsWrap.total || 0,
    clients_total: clientsWrap.total || 0,
    licenses_total: licenses.length,
    licenses_active: activeLic,
    trial_accounts: trial,
    sales_today_total: 0,
    problem_clients: [],
    weekly_sales: [],
    product_line: "security",
    source: "securetrack",
    bridge_error: clientsWrap.bridge_error || licWrap.bridge_error || null,
  };
}

async function createSecurityClient(body) {
  return securityAdminFetch("/api/admin/clients", {
    method: "POST",
    body: {
      emri: body.emri || body.name,
      email: body.email,
      telefon: body.telefon || body.telefoni,
      adresa: body.adresa,
      veprimtari: normalizeVeprimtari(body.veprimtari || body.tipi || "kompani_sigurie"),
    },
  });
}

async function updateSecurityClient(id, body) {
  const patch = {
    emri: body.emri || body.name,
    email: body.email,
    telefon: body.telefon || body.telefoni,
    adresa: body.adresa,
  };
  if (body.veprimtari != null || body.tipi != null) {
    patch.veprimtari = normalizeVeprimtari(body.veprimtari || body.tipi);
  }
  return securityAdminFetch(`/api/admin/clients/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

async function deleteSecurityClient(id) {
  return securityAdminFetch(`/api/admin/clients/${id}`, {
    method: "DELETE",
  });
}

async function issueSecurityLicense(body) {
  return securityAdminFetch("/api/admin/licenses", {
    method: "POST",
    body: {
      client_id: body.client_id,
      max_terminals: body.max_terminals || 1,
      expires_at: body.expires_at || null,
      license_key: body.license_key || body.celesi,
      app_type: "sekurim",
      status: "active",
    },
  });
}

async function setSecurityLicenseStatus(id, statusi) {
  const map = {
    aktive: "active",
    revokuar: "revoked",
    pezulluar: "suspended",
    skaduar: "expired",
    active: "active",
    revoked: "revoked",
    suspended: "suspended",
  };
  const status = map[String(statusi || "").toLowerCase()] || statusi;
  return securityAdminFetch(`/api/admin/licenses/${id}/status`, {
    method: "POST",
    body: { status },
  });
}

async function deleteSecurityLicense(id) {
  return securityAdminFetch(`/api/admin/licenses/${id}`, {
    method: "DELETE",
  });
}

async function updateSecurityLicense(id, patch = {}) {
  const body = {};
  if (patch.statusi || patch.status) {
    const map = {
      aktive: "active",
      revokuar: "revoked",
      pezulluar: "suspended",
      skaduar: "expired",
    };
    const raw = String(patch.statusi || patch.status || "").toLowerCase();
    body.status = map[raw] || raw;
  }
  if (patch.license_key || patch.celesi) {
    body.license_key = patch.license_key || patch.celesi;
  }
  if (patch.hardware_id != null) body.hardware_id = patch.hardware_id;
  if (patch.expires_at != null) body.expires_at = patch.expires_at;
  if (!Object.keys(body).length) {
    return setSecurityLicenseStatus(id, patch.statusi || "active");
  }
  return securityAdminFetch(`/api/admin/licenses/${id}`, {
    method: "PATCH",
    body,
  });
}

async function getSecurityClientDetail(clientId) {
  const [clientsWrap, licWrap] = await Promise.all([
    getSecurityClientsGrouped(),
    getSecurityLicensesView(),
  ]);
  const client = (clientsWrap.sectors || [])
    .flatMap((s) => s.clients || [])
    .find((c) => String(c.id) === String(clientId));
  if (!client) {
    const err = new Error("Klienti Security nuk u gjet");
    err.status = 404;
    throw err;
  }
  const licenses = (licWrap.licenses || [])
    .filter((l) => String(l.client_id) === String(clientId))
    .map((l) => ({
      id: l.id,
      celesi: l.license_key || "",
      license_key: l.license_key || "",
      hardware_id: l.hardware_id || "",
      device_id: l.device_id || "",
      statusi: l.statusi,
      data_skadimit: l.expires_at || null,
      product_line: "security",
    }));
  return {
    client: {
      ...client,
      tipi_label: client.veprimtari || client.tipi_label || "Security",
      package_label: "Security",
      icon: "🛡️",
      adresa: client.adresa || "",
    },
    licenses,
    owners: client.email
      ? [{ id: client.id, email: client.email, emri: client.emri, account_status: "active" }]
      : [],
    sales: { today: 0, last_30_days: 0, order_count_30d: 0, recent: [] },
    stock: { alerts: [], zero_items: [], zero_count: 0 },
    waiters: [],
    ai_usage: { tokens_total: 0, cost_eur_total: 0, calls: 0 },
    product_line: "security",
    source: "securetrack",
    bridge_error: clientsWrap.bridge_error || licWrap.bridge_error || null,
  };
}

async function setSecurityClientPassword(id, password) {
  return securityAdminFetch(`/api/admin/clients/${id}/password`, {
    method: "POST",
    body: { password },
  });
}

async function requestSecurityPasswordReset(id) {
  return securityAdminFetch(`/api/admin/clients/${id}/password-reset`, {
    method: "POST",
    body: {},
  });
}

module.exports = {
  normalizeProductLine,
  securityUpstream,
  getSecurityClientsGrouped,
  getSecurityLicensesView,
  getSecurityOverview,
  getSecurityClientDetail,
  createSecurityClient,
  updateSecurityClient,
  deleteSecurityClient,
  issueSecurityLicense,
  setSecurityLicenseStatus,
  deleteSecurityLicense,
  updateSecurityLicense,
  setSecurityClientPassword,
  requestSecurityPasswordReset,
  SECURITY_VEPRIMTARI,
  SECURITY_SECTORS,
};
