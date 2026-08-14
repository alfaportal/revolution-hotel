const { getSupabase } = require("../db");
const { TIER_LABELS, normalizePackageTier } = require("../lib/packages");
const { daysUntilTrialEnd, formatTrialDateSq } = require("../lib/trialDates");
const {
  isEmailConfigured,
  sendTrialExpiry7DayEmail,
  sendTrialExpiry1DayEmail,
  sendTrialExpiredEmail,
  sendAdminTrialExpiryAlertEmail,
} = require("./emailService");

const LICENSE_SELECT =
  "id, client_id, trial_ends_at, statusi, clients(id, emri, telefoni, email, package_tier)";

function packageLabel(tier) {
  const id = normalizePackageTier(tier);
  return TIER_LABELS[id] || id;
}

function buildAlertRow(license) {
  const client = license.clients || {};
  const days = daysUntilTrialEnd(license.trial_ends_at);
  return {
    license_id: license.id,
    client_id: license.client_id,
    client_name: client.emri || "—",
    phone: client.telefoni || "",
    package_tier: normalizePackageTier(client.package_tier),
    package_label: packageLabel(client.package_tier),
    trial_ends_at: license.trial_ends_at,
    expiry_date: formatTrialDateSq(license.trial_ends_at),
    days_remaining: days,
    status: days == null ? "unknown" : days < 0 ? "expired" : days === 0 ? "today" : "upcoming",
  };
}

async function fetchLicensesWithTrial() {
  const db = getSupabase();
  const { data, error } = await db
    .from("licenses")
    .select(LICENSE_SELECT)
    .not("trial_ends_at", "is", null)
    .order("trial_ends_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchSentNotificationMap(licenseIds) {
  if (!licenseIds.length) return new Map();
  const db = getSupabase();
  const { data, error } = await db
    .from("trial_notifications")
    .select("license_id, notification_type")
    .in("license_id", licenseIds);
  if (error) {
    if (/trial_notifications/i.test(error.message || "")) {
      const err = new Error(
        "Tabela trial_notifications mungon. Ekzekutoni supabase/migrations/017_trial_notifications.sql",
      );
      err.code = "MISSING_TRIAL_NOTIFICATIONS_TABLE";
      throw err;
    }
    throw error;
  }
  const map = new Map();
  for (const row of data || []) {
    if (!map.has(row.license_id)) map.set(row.license_id, new Set());
    map.get(row.license_id).add(row.notification_type);
  }
  return map;
}

async function recordNotification(licenseId, notificationType) {
  const db = getSupabase();
  const { error } = await db.from("trial_notifications").upsert(
    {
      license_id: licenseId,
      notification_type: notificationType,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "license_id,notification_type" },
  );
  if (error) throw error;
}

async function resolveOwnerEmail(clientId, clientRow) {
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("email")
    .eq("client_id", clientId)
    .eq("roli", "client_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const ownerEmail = String(data?.email || "").trim().toLowerCase();
  if (ownerEmail) return ownerEmail;
  return String(clientRow?.email || "").trim().toLowerCase() || null;
}

async function listTrialExpiryAlerts({ withinDays = 7 } = {}) {
  const licenses = await fetchLicensesWithTrial();
  const windowDays = Math.max(0, Number(withinDays) || 7);
  return licenses
    .map(buildAlertRow)
    .filter(row => row.days_remaining != null && row.days_remaining >= 0 && row.days_remaining <= windowDays)
    .sort((a, b) => a.days_remaining - b.days_remaining);
}

async function countTrialExpiryAlerts(withinDays = 7) {
  const alerts = await listTrialExpiryAlerts({ withinDays });
  return alerts.length;
}

async function processTrialNotifications() {
  if (!isEmailConfigured()) {
    console.log("[cron] trialNotifications: RESEND_API_KEY mungon — anashkalohet.");
    return { skipped: true, reason: "email_not_configured" };
  }

  const licenses = await fetchLicensesWithTrial();
  if (!licenses.length) {
    return { processed: 0, sent: {} };
  }

  const sentMap = await fetchSentNotificationMap(licenses.map(l => l.id));
  const stats = { owner_7d: 0, owner_1d: 0, owner_expired: 0, admin_7d: 0, errors: 0 };
  const adminBatch = [];

  for (const license of licenses) {
    const days = daysUntilTrialEnd(license.trial_ends_at);
    if (days == null) continue;

    const sent = sentMap.get(license.id) || new Set();
    const client = license.clients || {};
    const clientName = client.emri || "";
    const expiryDate = formatTrialDateSq(license.trial_ends_at);
    const ownerEmail = await resolveOwnerEmail(license.client_id, client);

    try {
      if (days === 7 && !sent.has("owner_7d") && ownerEmail) {
        await sendTrialExpiry7DayEmail({ to: ownerEmail, clientName, expiryDate });
        await recordNotification(license.id, "owner_7d");
        stats.owner_7d += 1;
        sent.add("owner_7d");
      }

      if (days === 7 && !sent.has("admin_7d")) {
        adminBatch.push(buildAlertRow(license));
      }

      if (days === 1 && !sent.has("owner_1d") && ownerEmail) {
        await sendTrialExpiry1DayEmail({ to: ownerEmail, clientName, expiryDate });
        await recordNotification(license.id, "owner_1d");
        stats.owner_1d += 1;
      }

      if (days <= 0 && !sent.has("owner_expired") && ownerEmail) {
        await sendTrialExpiredEmail({ to: ownerEmail, clientName });
        await recordNotification(license.id, "owner_expired");
        stats.owner_expired += 1;
      }
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[cron] trialNotifications license ${license.id}:`,
        err.message || err,
      );
    }
  }

  if (adminBatch.length) {
    const toNotify = [];
    for (const row of adminBatch) {
      const sent = sentMap.get(row.license_id) || new Set();
      if (!sent.has("admin_7d")) toNotify.push(row);
    }
    if (toNotify.length) {
      try {
        await sendAdminTrialExpiryAlertEmail({ clients: toNotify });
        for (const row of toNotify) {
          await recordNotification(row.license_id, "admin_7d");
          stats.admin_7d += 1;
        }
      } catch (err) {
        stats.errors += 1;
        console.error("[cron] trialNotifications admin batch:", err.message || err);
      }
    }
  }

  const total = stats.owner_7d + stats.owner_1d + stats.owner_expired + stats.admin_7d;
  if (total) {
    console.log(
      `[cron] trialNotifications: owner_7d=${stats.owner_7d} owner_1d=${stats.owner_1d} expired=${stats.owner_expired} admin_7d=${stats.admin_7d}`,
    );
  }

  return { processed: licenses.length, sent: stats };
}

module.exports = {
  listTrialExpiryAlerts,
  countTrialExpiryAlerts,
  processTrialNotifications,
};
