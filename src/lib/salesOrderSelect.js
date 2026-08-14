/** Fallback kur migrimi 021 (accepted_by_*) nuk është ekzekutuar ende në Supabase. */

function isMissingAcceptanceColumnError(error) {
  return /accepted_by|accepted_at/i.test(String(error?.message || error || ""));
}

function normalizeAcceptanceFields(row = {}) {
  return {
    ...row,
    accepted_by_waiter_id: row.accepted_by_waiter_id ?? null,
    accepted_by_waiter_name: String(row.accepted_by_waiter_name || "").trim(),
    accepted_at: row.accepted_at ?? null,
  };
}

/**
 * Ekzekuton query me select të plotë; nëse kolonat accepted_by mungojnë, provon pa to.
 * buildQuery(withAcceptance) → supabase query builder (para .then / await).
 */
async function selectWithAcceptanceFallback(buildQuery) {
  let result = await buildQuery(true);
  if (result.error && isMissingAcceptanceColumnError(result.error)) {
    result = await buildQuery(false);
  }
  if (result.error) throw result.error;
  return (result.data || []).map(normalizeAcceptanceFields);
}

/**
 * Shënon porosi si të pranuara — provon disa strategji kur kolonat accepted_* mungojnë në Supabase.
 */
async function updateOrdersAcceptance(db, { clientId, orderIds, waiterId = null, waiterName = "" }) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { ids: [], strategy: "none" };

  const now = new Date().toISOString();
  const name = String(waiterName || "").trim();
  const strategies = [
    {
      patch: {
        accepted_at: now,
        accepted_by_waiter_id: waiterId,
        accepted_by_waiter_name: name,
      },
      filterAcceptedNull: true,
    },
    {
      patch: { accepted_by_waiter_id: waiterId, accepted_by_waiter_name: name },
      filterAcceptedNull: false,
    },
    {
      patch: { accepted_at: now },
      filterAcceptedNull: false,
    },
  ];

  let lastError = null;
  for (const { patch, filterAcceptedNull } of strategies) {
    let q = db
      .from("sales_orders")
      .update(patch)
      .eq("client_id", clientId)
      .eq("status", "ordered")
      .in("id", ids);
    if (filterAcceptedNull) q = q.is("accepted_at", null);
    const { data, error } = await q.select("id");
    if (!error) {
      const acked = (data || []).map(row => row.id).filter(Boolean);
      if (acked.length) return { ids: acked, strategy: Object.keys(patch).join(",") };
      continue;
    }
    if (isMissingAcceptanceColumnError(error)) {
      lastError = error;
      continue;
    }
    throw error;
  }

  throw lastError || new Error("Nuk u shënuan porositë si të pranuara.");
}

function isOrderAccepted(row) {
  if (!row) return false;
  if (row.accepted_at) return true;
  if (String(row.accepted_by_waiter_name || "").trim()) return true;
  if (row.accepted_by_waiter_id) return true;
  return false;
}

module.exports = {
  isMissingAcceptanceColumnError,
  normalizeAcceptanceFields,
  selectWithAcceptanceFallback,
  updateOrdersAcceptance,
  isOrderAccepted,
};
