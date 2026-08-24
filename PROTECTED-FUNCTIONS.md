# PROTECTED FUNCTIONS — DO NOT MODIFY WITHOUT EXPLICIT PERMISSION

These functions were fixed on 2026-07-07 to resolve a double-billing bug: closing
a table and paying was inserting the sale into `daily_log` twice (double
receipt/invoice), and cloud sync could re-import a sale that was already
recorded locally.

On 2026-07-10, `isCloudOrderHandledLocally` and `importCloudOrderToLocal` were
fixed to stop takeaway/online order cards reappearing ~2s after payment: the
cloud poll (`online-orders-watcher.js`) was re-importing orders that were
already closed locally because only `active` orders counted as "handled" and
`importCloudOrderToLocal` explicitly reactivated completed rows.

Root causes fixed that day:
- `closeTablePartial` never set `cloud_sale_id`, so split-bill payments on
  cloud-linked orders couldn't be matched against the cloud's "closed sale"
  echo, weakening dedup down to a fuzzy fallback match.
- `/api/waiter/close-and-print` and `/api/waiter/split-close-and-print` in
  `server.js` had overlapping (non-mutually-exclusive) conditions that could
  push the same "table closed" sale to the cloud twice, which then came back
  through `syncClosedWebWaiterSales` as a second `daily_log` row.

Every function below is covered by `HOTEL/tests/protected-functions.test.js`,
which runs automatically before every `npm run build` (see
`scripts/pre-build-check.js`). If you believe one of these needs to change,
get explicit sign-off first, then update the matching test in the same change.

---

## 1. `closeTable`
- **File:** `database.js:1900`
- **What it does:** Closes the active order on a table after payment — marks
  the order `completed`, frees the table, and inserts **exactly one**
  `daily_log` row via `addDailyLogEntry` inside a single SQLite transaction.
  Also decrements menu stock for the sold items.
- **Why protected:** This is the single source of truth for "one payment = one
  daily_log row." Any second call to `addDailyLogEntry` here, or any code path
  that calls `closeTable` twice for the same payment, reproduces the
  double-billing bug.

## 2. `computeShiftTotals`
- **File:** `database.js:2282`
- **What it does:** Sums `daily_log` rows for a shift — `WHERE status =
  'completed' AND shift_id = ?`. Powers the waiter's cash/card totals shown at
  shift close (via `getWaiterShiftSummary`).
- **Why protected:** Must only ever aggregate rows whose `shift_id` matches
  the requested shift. Loosening the `WHERE` clause (e.g. matching by
  `waiter_name` or date instead of `shift_id`) would let one waiter's shift
  total include another waiter's or another shift's sales.

## 3. `syncClosedWebWaiterSales` (async)
- **File:** `cloud-sync.js:1213`
- **What it does:** Polls `/api/v1/license/waiter-closed-sales` (every 12s via
  `cloud-auto-sync.js`, plus on SSE "closed"/"free" events) and calls
  `importClosedWebWaiterSaleFromCloud` for each sale returned.
- **Why protected:** This is the exact path that re-introduces a sale that was
  already written locally by `closeTable`/`closeTablePartial`. It relies
  entirely on the dedup logic in `importClosedWebWaiterSaleFromCloud` to avoid
  double entries.

## 4. `importClosedWebWaiterSaleFromCloud`
- **File:** `database.js:3441`
- **What it does:** Imports one cloud-closed sale into `daily_log`. Skips it if
  already imported (`isCloudWaiterSaleImported` — matches by `cloud_sale_id`)
  or if a matching local row already exists
  (`findExistingDailyLogForCloudImport` — matches by `cloud_sale_id`, or falls
  back to same table + total + within 60s).
- **Why protected:** This is the dedup gate for the whole cloud-import path.
  Any local `addDailyLogEntry` call that omits `cloud_sale_id` (like the
  `closeTablePartial` bug fixed today) defeats the ID-based half of this check
  and pushes all the weight onto the fuzzy fallback.

## 5. `attachCloudSaleToWaiterShift`
- **File:** `database.js:2261`
- **What it does:** Backfills `staff_id`/`shift_id` on an orphaned `daily_log`
  row (one imported before the waiter's shift existed) once their shift opens
  — matched strictly by `cloud_sale_id` and `shift_id IS NULL`.
- **Why protected:** Loosening the match (e.g. dropping `shift_id IS NULL` or
  `cloud_sale_id`) could reattach a sale to the wrong shift or reattach the
  same sale twice.

## 6. `logMetaForCloudWaiterSale`
- **File:** `database.js:3367`
- **What it does:** Resolves which `staff_id`/`shift_id` a cloud sale belongs
  to when importing it, and explicitly returns `shift_id: null` ("orphan") if
  the sale closed before the waiter's current shift opened.
- **Why protected:** This is what keeps a sale from a *previous* shift out of
  the *current* shift's totals during cloud import. Removing the
  before-shift-start check would let stale sales inflate today's shift.

## 7. `syncLocalCancelledFromCloud` (async)
- **File:** `cloud-sync.js:1292`
- **What it does:** Reconciles local active orders against the cloud's live
  table view — frees/cancels local orders only when they are cloud-linked
  (`order.cloud_order_id` set) and the cloud no longer has a matching active
  order. Guarded by `if (!order.cloud_order_id) continue;`.
- **Why protected:** Plain dine-in orders (no `cloud_order_id`) must never be
  touched by this sync. Removing that guard would let cloud-connectivity
  hiccups cancel purely local tables.

## 8. `freeLocalTableFromCloudEvent`
- **File:** `cloud-sync.js:1781`
- **What it does:** Handles an incoming "closed"/"free" SSE event from the
  cloud by freeing the matching local table — but only completes/cancels the
  local order if it is itself cloud-linked (`isCloudPickupOrder`); otherwise it
  only frees the `tables` row and explicitly leaves a local-only active order
  untouched.
- **Why protected:** Same class of bug as #7 — must not let a cloud event for
  one waiter's cloud order "steal"/close another waiter's plain local order on
  the same table number.

## 9. `decrementMenuItemStock`
- **File:** `database.js` (`decrementMenuItemStock`)
- **What it does:** Reduces `menu_items.stock_qty` for each sold item
  (`MAX(0, stock_qty - quantity)`), called once per close inside the same
  transaction as the `daily_log` insert. Resolves product by `menu_item_id` /
  `menu_id` / `local_id`, then by item name if id mungon. Logs
  `[stock] decrement productId=… qty=… stockBefore=… stockAfter=…`.
- **Why protected:** Must run exactly once per payment, in the same
  transaction as the `daily_log` insert it's paired with — if `closeTable` or
  `closeTablePartial` were ever called twice for one payment (the bug fixed
  today), stock would be decremented twice too.

## 10. `finalizeLocalTableAfterCloudSaleClose`
- **File:** `database.js:3405`
- **What it does:** After importing a cloud-closed sale, marks the matching
  local order `completed`/table `free`. Matches by `cloud_order_id` first;
  when falling back to table number, only touches the active local order if
  it is itself cloud-linked (`isCloudPickupOrder`) — a plain local order on
  that table number is explicitly left alone (logged as SKIP).
- **Why protected:** Same invariant as #7/#8, enforced at the point where a
  cloud sale import actually mutates local `orders`/`tables` rows.

## 11. `isCloudOrderHandledLocally`
- **File:** `database.js:1246`
- **What it does:** Returns whether a cloud `sales_orders` UUID is already
  represented locally — `active` (being worked on), `completed` (paid/closed),
  or `cancelled`. Used by `online-orders-watcher.js`, accept-queue filtering,
  and `cloud-sync.js` pending-table protection to skip cloud orders that must
  not be shown or re-imported.
- **Why protected:** When this only checked `status = 'active'`, a paid
  takeaway order became "unhandled" after `closeTable` and the 2s cloud poll
  treated it as a fresh import candidate — the card disappeared then reappeared.
  Removing `completed`/`cancelled` from this check reopens that bug even if
  cloud close is slow or fails.

## 12. `importCloudOrderToLocal`
- **File:** `database.js:1684`
- **What it does:** Imports one cloud order onto a local table/slot (takeaway,
  QR, phone waiter). If an **active** local row already exists for the cloud ID,
  returns it. If a **non-active** local row exists (`completed`/`cancelled`),
  returns `{ already: true, closed/cancelled: true }` without mutating DB. Only
  inserts or merges when there is no prior terminal local row.
- **Why protected:** The pre-2026-07-10 version **reactivated** completed orders
  (`UPDATE orders SET status = 'active'` + `tables.status = 'occupied'`) when
  cloud still showed the slot as accepted — exactly the "pay → card gone → card
  back" bug. Any reintroduction of reactivation or a second INSERT for the same
  cloud UUID can duplicate UI state and, in edge cases, billing.

---

## FISKAL — WRITE-ONCE + FORMATI (Rregullat #14 dhe #15)

### 13. `generateFiscalReceipt()` — E MBROJTUR
- **File:** `fiscal/fiscal-print.js`
- **What it does:** Gjeneron tekstin e kuponit fiskal (header → artikuj → TOTALI NE EURO → TOT. PA TVSH → TVSH → pagesa → NUIKF → Nr. SEF). Pas gjenerimit thërret `assertGeneratedReceiptText`.
- **Why protected:** Layout ATK / Neni 7. Ndryshimi pa aprovim prish përputhshmërinë fiskale dhe hash-in e strukturës.

### 14. `validateReceiptBeforePrint()` — E MBROJTUR
- **File:** `fiscal/fiscal-receipt-guard.js`
- **What it does:** Kontrollon PARA çdo printimi: NUIKF, QR, Logo RKS/MF, TOTALI NE EURO, TOT. PA TVSH, TVSH breakdown, data/ora, operatori, valuta EUR, radhitjen. Në dështim bllokon printimin dhe logon `receipt_format_violation` në audit.
- **Why protected:** Mbrojtje absolute e formatit — pa këtë, kupon i paplotë mund të dalë në printer.
- **Shënim:** Rregulli #14 në `.cursorrules` mbulon edhe WRITE-ONCE (`fiscalReceiptUpdate`, trigger-at SQL) dhe toggle OFF = sjellje e pandryshuar.

### 15. `RECEIPT_FORMAT_HASH` — E MBROJTUR
- **File:** `fiscal/fiscal-receipt-guard.js`
- **What it does:** SHA256 i `STRUCTURE_SPEC` (radhitja + fusha të mbyllura). Në load dhe para validimit, nëse hash-i nuk përputhet → error, nuk printohet.
- **Why protected:** Çdo ndryshim i fshehtë i strukturës duhet të dështojë haptazi derisa të aprovohet dhe të përditësohet hash-i.

### 16. `fiscalReceiptUpdate()` — E MBROJTUR (WRITE-ONCE)
- **File:** `fiscal/fiscal-db.js`
- **What it does:** UPDATE i vetëm i lejuar në `fiscal_receipts` — kolonat: `sent_to_atk`, `sent_at`, `atk_response_json`. Trigger SQL bllokon UPDATE/DELETE të fushave të tjera dhe të `fiscal_audit_log`.
- **Why protected:** Kërkesë ligjore WRITE-ONCE për kuponët fiskalë.
