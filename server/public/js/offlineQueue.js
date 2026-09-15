/**
 * IndexedDB queue për porosi waiter offline + cache bootstrap.
 * Eksporton window.OfflineQueue
 */
(function () {
  const DB_NAME = "ri-pos-offline";
  const DB_VERSION = 1;
  const STORE_ORDERS = "waiter_orders";
  const STORE_BOOTSTRAP = "waiter_bootstrap";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("IndexedDB dështoi."));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ORDERS)) {
          const orders = db.createObjectStore(STORE_ORDERS, { keyPath: "id" });
          orders.createIndex("slug_status", ["slug", "status"], { unique: false });
          orders.createIndex("created_at", "created_at", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_BOOTSTRAP)) {
          db.createObjectStore(STORE_BOOTSTRAP, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
  }

  function tx(storeName, mode = "readonly") {
    return openDb().then(db => {
      const transaction = db.transaction(storeName, mode);
      return { store: transaction.objectStore(storeName), transaction };
    });
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB gabim."));
    });
  }

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function bootstrapKey(slug, kitchenKey) {
    return `${String(slug || "").trim()}|${String(kitchenKey || "").trim()}`;
  }

  async function enqueueWaiterOrder({ slug, kitchenKey, waiterToken, url, body }) {
    const row = {
      id: newId(),
      slug: String(slug || "").trim(),
      kitchen_key: String(kitchenKey || "").trim(),
      waiter_token: String(waiterToken || "").trim(),
      url: String(url || "").trim(),
      body: body && typeof body === "object" ? body : {},
      created_at: new Date().toISOString(),
      status: "pending",
    };
    if (!row.slug || !row.url) throw new Error("Mungojnë të dhënat e porosisë offline.");
    const { store, transaction } = await tx(STORE_ORDERS, "readwrite");
    await reqToPromise(store.add(row));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return row;
  }

  async function listPendingOrders(slug) {
    const { store } = await tx(STORE_ORDERS, "readonly");
    const all = await reqToPromise(store.getAll());
    return (all || [])
      .filter(row => row.status === "pending" && (!slug || row.slug === slug))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  async function countPendingOrders(slug) {
    const rows = await listPendingOrders(slug);
    return rows.length;
  }

  async function updateOrderStatus(id, status) {
    const { store, transaction } = await tx(STORE_ORDERS, "readwrite");
    const row = await reqToPromise(store.get(id));
    if (!row) return null;
    row.status = status;
    await reqToPromise(store.put(row));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(row);
      transaction.onerror = () => reject(transaction.error);
    });
    return row;
  }

  async function removeOrder(id) {
    const { store, transaction } = await tx(STORE_ORDERS, "readwrite");
    await reqToPromise(store.delete(id));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function saveBootstrapCache(slug, kitchenKey, data) {
    const key = bootstrapKey(slug, kitchenKey);
    const row = {
      key,
      slug: String(slug || "").trim(),
      data,
      saved_at: new Date().toISOString(),
    };
    const { store, transaction } = await tx(STORE_BOOTSTRAP, "readwrite");
    await reqToPromise(store.put(row));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(row);
      transaction.onerror = () => reject(transaction.error);
    });
    return row;
  }

  async function loadBootstrapCache(slug, kitchenKey) {
    const key = bootstrapKey(slug, kitchenKey);
    const { store } = await tx(STORE_BOOTSTRAP, "readonly");
    const row = await reqToPromise(store.get(key));
    return row?.data || null;
  }

  async function syncWaiterOrders({ slug, fetchImpl = fetch, apiHeaders = () => ({}) } = {}) {
    const pending = await listPendingOrders(slug);
    let synced = 0;
    const errors = [];

    for (const row of pending) {
      await updateOrderStatus(row.id, "syncing");
      try {
        const res = await fetchImpl(row.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(row.kitchen_key ? { "x-kitchen-key": row.kitchen_key } : {}),
            ...apiHeaders(row),
          },
          body: JSON.stringify(row.body),
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          /* ignore */
        }
        if (!res.ok || data.ok === false) {
          throw new Error(data.gabim || `HTTP ${res.status}`);
        }
        await removeOrder(row.id);
        synced += 1;
      } catch (err) {
        await updateOrderStatus(row.id, "pending");
        errors.push({ id: row.id, message: err.message || String(err) });
        break;
      }
    }

    const remaining = await countPendingOrders(slug);
    return { synced, remaining, errors };
  }

  function initConnectionStatus(badgeEl, { onOnline } = {}) {
    if (!badgeEl) return () => {};

    const update = () => {
      const online = navigator.onLine;
      badgeEl.textContent = online ? "Online" : "Offline";
      badgeEl.classList.toggle("is-online", online);
      badgeEl.classList.toggle("is-offline", !online);
      badgeEl.setAttribute("aria-live", "polite");
      if (online && typeof onOnline === "function") onOnline();
    };

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();

    return update;
  }

  window.OfflineQueue = {
    enqueueWaiterOrder,
    listPendingOrders,
    countPendingOrders,
    syncWaiterOrders,
    saveBootstrapCache,
    loadBootstrapCache,
    initConnectionStatus,
  };
})();
