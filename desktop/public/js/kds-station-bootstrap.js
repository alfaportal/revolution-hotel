/**
 * Kuzhinë / banak — lidhje automatik me POS pa PIN kamarieri.
 */
(function (global) {
  async function pingToken(token) {
    const t = String(token || "").trim();
    if (!t) return false;
    try {
      const res = await fetch("/api/session/ping", {
        headers: { "X-Session-Token": t },
        cache: "no-store",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function saveSession(role, data) {
    const sess = {
      emri: data.emri || "",
      roli: data.roli || role,
      token: data.token,
      login_time: data.login_time || null,
      staff_id: data.staff_id != null ? data.staff_id : null,
    };
    if (global.KdsStationSession) {
      global.KdsStationSession.save(role, sess);
    } else {
      try {
        sessionStorage.setItem("rh_user", JSON.stringify(sess));
      } catch {
        /* ignore */
      }
    }
    return sess;
  }

  async function ensureKdsStationSession(role) {
    const r = String(role || "").trim().toLowerCase();
    if (r !== "kuzhina" && r !== "banaku") {
      throw new Error("Roli i panjohur stacion KDS.");
    }

    if (global.KdsStationSession) {
      const saved = global.KdsStationSession.load(r);
      if (saved?.token && (await pingToken(saved.token))) {
        global.KdsStationSession.restoreToSessionStorage(r);
        return saved;
      }
    }

    const res = await fetch("/api/login/kds-station", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role: r }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      throw new Error(data.gabim || "Nuk u lidh stacioni me POS.");
    }
    return saveSession(r, data);
  }

  global.RhKdsStationBootstrap = { ensureKdsStationSession, pingToken };
})(typeof window !== "undefined" ? window : globalThis);
