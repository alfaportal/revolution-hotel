const { getSupabase } = require("../db");
const {
  isEmailConfigured,
  sendOwnerClientOfflineEmail,
} = require("./emailService");

const MILESTONES = [12, 24, 36, 48];
const MS_HOUR = 60 * 60 * 1000;

function pickLatestIso(values) {
  let best = null;
  let bestMs = 0;
  for (const v of values) {
    if (!v) continue;
    const ms = new Date(v).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!best || ms > bestMs) {
      best = v;
      bestMs = ms;
    }
  }
  return best;
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms / MS_HOUR;
}

function normalizeOfflineSince(iso) {
  if (!iso) return new Date(0).toISOString();
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return new Date(0).toISOString();
  return d.toISOString();
}

async function resolveOwnerEmail(clientId, clientEmail) {
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
  return String(clientEmail || "").trim().toLowerCase() || null;
}

async function fetchClientOfflineSnapshots() {
  const db = getSupabase();
  const [{ data: licenses, error: licErr }, { data: terminals, error: termErr }] =
    await Promise.all([
      db
        .from("licenses")
        .select(
          "id, client_id, statusi, last_activated_at, last_validation_at, clients(id, emri, email, telefoni, aktiv)",
        )
        .neq("statusi", "revokuar"),
      db.from("license_terminals").select("license_id, last_seen_at"),
    ]);

  if (licErr) throw licErr;
  if (termErr) {
    console.warn("[cron] offlineNotifications terminals:", termErr.message || termErr);
  }

  const seenByLicense = new Map();
  for (const t of terminals || []) {
    if (!t.license_id || !t.last_seen_at) continue;
    const prev = seenByLicense.get(t.license_id);
    if (!prev || new Date(t.last_seen_at) > new Date(prev)) {
      seenByLicense.set(t.license_id, t.last_seen_at);
    }
  }

  /** @type {Map<string, object>} */
  const byClient = new Map();

  for (const lic of licenses || []) {
    const client = lic.clients || {};
    const clientId = lic.client_id || client.id;
    if (!clientId) continue;
    if (client.aktiv === false) continue;
    if (!["aktive", "skaduar", "pezulluar"].includes(String(lic.statusi || ""))) continue;

    const lastSeen = pickLatestIso([
      seenByLicense.get(lic.id),
      lic.last_validation_at,
      lic.last_activated_at,
    ]);
    // Pa heartbeat real — mos dërgo email (klient i ri / i painstaluar)
    if (!lastSeen) continue;

    const hours = hoursSince(lastSeen);
    const prev = byClient.get(clientId);
    // Merr last_seen më të ri (më pak offline) për klientin
    if (prev && hours >= prev.hours_offline) continue;

    byClient.set(clientId, {
      client_id: clientId,
      license_id: lic.id,
      client_name: client.emri || "—",
      client_email: client.email || "",
      phone: client.telefoni || "",
      last_seen_at: lastSeen,
      offline_since: normalizeOfflineSince(lastSeen),
      hours_offline: hours,
    });
  }

  return [...byClient.values()].filter((c) => c.hours_offline >= 12);
}

async function fetchSentMilestones(clientId, offlineSince) {
  const db = getSupabase();
  const { data, error } = await db
    .from("offline_notifications")
    .select("milestone_hours")
    .eq("client_id", clientId)
    .eq("offline_since", offlineSince);
  if (error) {
    if (/offline_notifications/i.test(error.message || "")) {
      const err = new Error(
        "Tabela offline_notifications mungon. Ekzekutoni supabase/migrations/054_offline_notifications.sql",
      );
      err.code = "MISSING_OFFLINE_NOTIFICATIONS_TABLE";
      throw err;
    }
    throw error;
  }
  return new Set((data || []).map((r) => Number(r.milestone_hours)));
}

async function recordMilestone(row, milestoneHours) {
  const db = getSupabase();
  const { error } = await db.from("offline_notifications").upsert(
    {
      client_id: row.client_id,
      license_id: row.license_id || null,
      offline_since: row.offline_since,
      milestone_hours: milestoneHours,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "client_id,offline_since,milestone_hours" },
  );
  if (error) throw error;
}

async function processOfflineNotifications() {
  if (!isEmailConfigured()) {
    console.log("[cron] offlineNotifications: RESEND_API_KEY mungon — anashkalohet.");
    return { skipped: true, reason: "email_not_configured" };
  }

  const offline = await fetchClientOfflineSnapshots();
  const stats = { checked: offline.length, sent: 0, skipped: 0, no_email: 0, errors: 0 };

  for (const row of offline) {
    let sentSet;
    try {
      sentSet = await fetchSentMilestones(row.client_id, row.offline_since);
    } catch (err) {
      if (err.code === "MISSING_OFFLINE_NOTIFICATIONS_TABLE") {
        console.error("[cron] offlineNotifications:", err.message);
        return { skipped: true, reason: "missing_table" };
      }
      throw err;
    }

    let ownerEmail = null;
    try {
      ownerEmail = await resolveOwnerEmail(row.client_id, row.client_email);
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[cron] offlineNotifications owner email ${row.client_id}:`,
        err.message || err,
      );
      continue;
    }
    if (!ownerEmail) {
      stats.no_email += 1;
      console.warn(
        `[cron] offlineNotifications: pa email pronari — ${row.client_name} (${row.client_id})`,
      );
      continue;
    }

    for (const milestone of MILESTONES) {
      if (row.hours_offline < milestone) continue;
      if (sentSet.has(milestone)) {
        stats.skipped += 1;
        continue;
      }
      try {
        await sendOwnerClientOfflineEmail({
          to: ownerEmail,
          clientName: row.client_name,
          hoursOffline: row.hours_offline,
          milestoneHours: milestone,
          lastSeenAt: row.last_seen_at,
          atkWarning: milestone >= 48,
        });
        await recordMilestone(row, milestone);
        sentSet.add(milestone);
        stats.sent += 1;
      } catch (err) {
        stats.errors += 1;
        console.error(
          `[cron] offlineNotifications client ${row.client_id} @${milestone}h:`,
          err.message || err,
        );
      }
    }
  }

  console.log(
    `[cron] offlineNotifications: checked=${stats.checked} sent=${stats.sent} skipped=${stats.skipped} no_email=${stats.no_email} errors=${stats.errors}`,
  );
  return stats;
}

module.exports = {
  processOfflineNotifications,
  MILESTONES,
};
