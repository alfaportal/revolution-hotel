const { getPgPool, withPgTransaction } = require("../lib/pgPool");
const { ensureWaiterTablesSchema } = require("../lib/ensureWaiterTablesSchema");

const MAX_TABLE_NUMBER = 30;

function sanitizeTableNumbers(list) {
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((v) => {
    const n = Math.trunc(Number(v));
    if (Number.isFinite(n) && n >= 1 && n <= MAX_TABLE_NUMBER) seen.add(n);
  });
  return [...seen].sort((a, b) => a - b);
}

/**
 * Kthen gjendjen e caktimeve për një klient:
 *  - hasAny: a ka ndonjë caktim fare (nëse jo → filtrimi nuk aktivizohet).
 *  - byWaiter: Map<waiter_id, number[]>.
 *  - assignedNumbers: Set<number> me krejt tavolinat e caktuara.
 */
async function getAssignmentState(clientId) {
  const empty = { hasAny: false, byWaiter: new Map(), assignedNumbers: new Set() };
  if (!clientId) return empty;

  const ok = await ensureWaiterTablesSchema();
  const pool = getPgPool();
  if (!ok || !pool) return empty;

  const { rows } = await pool.query(
    "SELECT waiter_id, table_number FROM pos_waiter_tables WHERE client_id = $1",
    [clientId],
  );

  const byWaiter = new Map();
  const assignedNumbers = new Set();
  for (const row of rows) {
    const wid = row.waiter_id;
    const num = Number(row.table_number);
    if (!byWaiter.has(wid)) byWaiter.set(wid, []);
    byWaiter.get(wid).push(num);
    assignedNumbers.add(num);
  }
  byWaiter.forEach((arr) => arr.sort((a, b) => a - b));

  return { hasAny: rows.length > 0, byWaiter, assignedNumbers };
}

/** Tavolinat e caktuara për një kamarier të vetëm. */
async function getAssignedTablesForWaiter(clientId, waiterId) {
  if (!clientId || !waiterId) return [];
  const state = await getAssignmentState(clientId);
  return state.byWaiter.get(waiterId) || [];
}

/**
 * Vendos SAKTËSISHT listën e tavolinave për një kamarier.
 * Tavolinat që janë të një kamarieri tjetër, i "kallen" këtij (upsert mbi table_number).
 */
async function setWaiterTables(clientId, waiterId, tableNumbers) {
  if (!clientId) throw new Error("Mungon klienti.");
  if (!waiterId) throw new Error("Mungon kamarieri.");

  const ok = await ensureWaiterTablesSchema();
  const pool = getPgPool();
  if (!ok || !pool) throw new Error("Baza e të dhënave nuk është e disponueshme.");

  const numbers = sanitizeTableNumbers(tableNumbers);

  await withPgTransaction(async (client) => {
    // Hiq caktimet aktuale të këtij kamarieri.
    await client.query(
      "DELETE FROM pos_waiter_tables WHERE client_id = $1 AND waiter_id = $2",
      [clientId, waiterId],
    );
    // Cakto tavolinat e reja (duke i marrë nga kamarieri tjetër nëse ishin të zëna).
    for (const num of numbers) {
      await client.query(
        `INSERT INTO pos_waiter_tables (client_id, waiter_id, table_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id, table_number)
         DO UPDATE SET waiter_id = EXCLUDED.waiter_id, created_at = now()`,
        [clientId, waiterId, num],
      );
    }
  });

  return numbers;
}

module.exports = {
  getAssignmentState,
  getAssignedTablesForWaiter,
  setWaiterTables,
  sanitizeTableNumbers,
};
