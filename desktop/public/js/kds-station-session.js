(function (global) {
  const KEYS = {
    kuzhina: "rh_kds_station_kuzhina_v1",
    banaku: "rh_kds_station_banaku_v1",
  };

  function normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
  }

  function storageKey(role) {
    return KEYS[normalizeRole(role)] || "";
  }

  function pack(payload) {
    if (!payload?.token) return null;
    const roli = normalizeRole(payload.roli || payload.role);
    if (roli !== "kuzhina" && roli !== "banaku") return null;
    return {
      emri: payload.emri || "",
      roli,
      token: String(payload.token),
      login_time: payload.login_time || null,
      staff_id: payload.staff_id != null ? payload.staff_id : null,
    };
  }

  function save(role, payload) {
    const data = pack({ ...payload, roli: payload?.roli || role });
    const key = storageKey(data?.roli || role);
    if (!key || !data) return;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      sessionStorage.setItem("rh_user", JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function load(role) {
    const r = normalizeRole(role);
    const key = storageKey(r);
    if (!key) return null;
    try {
      let raw = localStorage.getItem(key);
      if (!raw) raw = sessionStorage.getItem("rh_user");
      const parsed = JSON.parse(raw || "null");
      if (!parsed?.token || normalizeRole(parsed.roli) !== r) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function clear(role) {
    const key = storageKey(role);
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function restoreToSessionStorage(role) {
    const data = load(role);
    if (!data) return null;
    try {
      sessionStorage.setItem("rh_user", JSON.stringify(data));
    } catch {
      /* ignore */
    }
    return data;
  }

  global.KdsStationSession = {
    save,
    load,
    clear,
    restoreToSessionStorage,
    isKdsRole: (role) => normalizeRole(role) === "kuzhina" || normalizeRole(role) === "banaku",
  };
})(typeof window !== "undefined" ? window : globalThis);
