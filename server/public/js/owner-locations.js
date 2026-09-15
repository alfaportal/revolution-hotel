(function () {
  const ALL_VALUE = "__all__";

  function getSelect() {
    return document.getElementById("owner-location-select");
  }

  function getWrap() {
    return document.getElementById("owner-location-switcher");
  }

  function locationLabel(loc) {
    const tip = loc.tipi === "kafene" ? "Kafene" : loc.tipi === "restorant" ? "Restorant" : loc.tipi === "dyqan" ? "Dyqan" : "Lokal";
    return loc.adresa ? `${loc.emri} · ${tip}` : `${loc.emri} (${tip})`;
  }

  function renderSwitcher(state) {
    const wrap = getWrap();
    const sel = getSelect();
    if (!wrap || !sel) return;

    if (!state?.multi_location) {
      wrap.classList.add("hidden");
      return;
    }

    wrap.classList.remove("hidden");
    const activeId = state.active_client_id || "";
    const viewAll = !!state.view_all;

    sel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = ALL_VALUE;
    allOpt.textContent = `Të gjitha lokalet (${(state.locations || []).length})`;
    allOpt.selected = viewAll;
    sel.appendChild(allOpt);

    for (const loc of state.locations || []) {
      const opt = document.createElement("option");
      opt.value = loc.id;
      opt.textContent = locationLabel(loc);
      opt.selected = !viewAll && loc.id === activeId;
      sel.appendChild(opt);
    }
  }

  async function switchLocation(value) {
    const sel = getSelect();
    if (sel) sel.disabled = true;
    try {
      const body =
        value === ALL_VALUE
          ? { view_all: true }
          : { client_id: value, view_all: false };

      const data = await window.ownerApi("/api/owner/switch-location", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (data.token && typeof window.setOwnerToken === "function") {
        window.setOwnerToken(data.token);
      }

      renderSwitcher(data);

      if (typeof window.reloadOwnerDashboard === "function") {
        await window.reloadOwnerDashboard();
      }
    } catch (err) {
      alert(err.message || "Nuk u ndryshua lokali.");
    } finally {
      if (sel) sel.disabled = false;
    }
  }

  async function initOwnerLocationSwitcher() {
    try {
      const data = await window.ownerApi("/api/owner/locations");
      renderSwitcher(data);
    } catch (err) {
      console.warn("owner locations:", err.message);
    }
  }

  window.initOwnerLocationSwitcher = initOwnerLocationSwitcher;

  function bindSelect() {
    const sel = getSelect();
    if (!sel || sel.dataset.bound === "1") return;
    sel.dataset.bound = "1";
    sel.addEventListener("change", () => {
      switchLocation(sel.value);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSelect);
  } else {
    bindSelect();
  }
})();
