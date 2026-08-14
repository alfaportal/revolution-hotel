const { getSupabase } = require("../db");
const { logOwnerActivity } = require("./ownerAuditService");

/** Shpenzime operative ditore (jashtë blerjeve të stokut) — pastrim, shërbime,
 * shpenzime të papritura, etj. CRUD i plotë, çdo ndryshim regjistrohet te
 * owner_activity_log (kategoria, shuma, kush e futi/ndryshoi/fshiu). */
const EXPENSE_CATEGORIES = {
  pastrim: "Pastrim",
  sherbime: "Shërbime",
  papritur: "Shpenzim i papritur",
  tjeter: "Tjetër",
};

function normalizeCategory(raw) {
  const v = String(raw || "tjeter").trim().toLowerCase();
  return EXPENSE_CATEGORIES[v] ? v : "tjeter";
}

function normalizeAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Shuma e shpenzimit duhet të jetë numër pozitiv.");
  }
  return Math.round(n * 100) / 100;
}

function normalizeExpenseDate(raw) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw || "")) ? raw : new Date().toISOString().slice(0, 10);
}

function normalizeVendorName(raw) {
  const v = String(raw || "").trim().slice(0, 200);
  if (!v) {
    throw new Error("Emri i firmës është i detyrueshëm.");
  }
  return v;
}

function expenseLabel(row) {
  const vendor = row.vendor_name ? ` (${row.vendor_name})` : "";
  return `${EXPENSE_CATEGORIES[row.category] || row.category} — ${Number(row.amount).toFixed(2)}€${vendor}`;
}

async function listOwnerExpenses(clientId, { from = "", to = "", limit = 200 } = {}) {
  const db = getSupabase();
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  let query = db
    .from("owner_expenses")
    .select("*")
    .eq("client_id", clientId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(cap);
  if (from) query = query.gte("expense_date", from);
  if (to) query = query.lte("expense_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function createOwnerExpense(clientId, body, actorEmail) {
  const category = normalizeCategory(body?.category);
  const amount = normalizeAmount(body?.amount);
  const description = String(body?.description || "").trim().slice(0, 500);
  const expense_date = normalizeExpenseDate(body?.expense_date);
  const vendor_name = normalizeVendorName(body?.vendor_name);

  const db = getSupabase();
  const { data, error } = await db
    .from("owner_expenses")
    .insert({
      client_id: clientId,
      category,
      amount,
      description,
      entered_by: String(actorEmail || "").trim(),
      expense_date,
      vendor_name,
    })
    .select()
    .single();
  if (error) throw error;

  await logOwnerActivity(clientId, {
    actorEmail,
    action: "expense_added",
    targetType: "expense",
    targetId: data.id,
    targetLabel: expenseLabel(data),
    details: { category, amount, description, expense_date, vendor_name },
  });

  return data;
}

async function updateOwnerExpense(clientId, id, body, actorEmail) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("owner_expenses")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", id)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Shpenzimi nuk u gjet.");

  const patch = {};
  if (body?.category != null) patch.category = normalizeCategory(body.category);
  if (body?.amount != null) patch.amount = normalizeAmount(body.amount);
  if (body?.description != null) patch.description = String(body.description).trim().slice(0, 500);
  if (body?.expense_date != null) patch.expense_date = normalizeExpenseDate(body.expense_date);
  if (body?.vendor_name != null) patch.vendor_name = normalizeVendorName(body.vendor_name);

  const { data, error } = await db
    .from("owner_expenses")
    .update(patch)
    .eq("client_id", clientId)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  await logOwnerActivity(clientId, {
    actorEmail,
    action: "expense_updated",
    targetType: "expense",
    targetId: id,
    targetLabel: expenseLabel(data),
    details: { before: { category: existing.category, amount: existing.amount, description: existing.description, expense_date: existing.expense_date, vendor_name: existing.vendor_name }, after: patch },
  });

  return data;
}

async function deleteOwnerExpense(clientId, id, actorEmail) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("owner_expenses")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", id)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Shpenzimi nuk u gjet.");

  const { error } = await db.from("owner_expenses").delete().eq("client_id", clientId).eq("id", id);
  if (error) throw error;

  await logOwnerActivity(clientId, {
    actorEmail,
    action: "expense_deleted",
    targetType: "expense",
    targetId: id,
    targetLabel: expenseLabel(existing),
    details: { category: existing.category, amount: existing.amount, description: existing.description, expense_date: existing.expense_date, vendor_name: existing.vendor_name },
  });

  return { deleted: true };
}

module.exports = {
  EXPENSE_CATEGORIES,
  listOwnerExpenses,
  createOwnerExpense,
  updateOwnerExpense,
  deleteOwnerExpense,
};
