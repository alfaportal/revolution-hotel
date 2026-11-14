(function () {
  let floorState = { terrasa_enabled: false, zones: [] };
  let floorDirty = false;
  let floorSaveTimer = null;
  let floorSaving = false;

  function isOnlineZone(name) {
    const n = String(name || "").trim().toLowerCase();
    return n === "porosi online" || n === "commandes en ligne" || /porosi\s*online/i.test(n);
  }

  function isTerraceZone(name) {
    const n = String(name || "").trim().toLowerCase();
    return /^(terrasa|terrace|terrasse|terras|terasa|terraca|ballokoni|ballkoni|balcony|ballkon|balcon|patio|veranda)\b/.test(n);
  }

  function zoneKind(name) {
    if (isOnlineZone(name)) return "online";
    if (isTerraceZone(name)) return "terrace";
    return "dining";
  }

  function isMainDiningZone(name) {
    const n = String(name || "").trim().toLowerCase();
    return n === "kryesore" || n === "principale" || n === "main"
      || n === "restoranti" || n === "restaurant" || n === "bari" || n === "bar";
  }

  function diningZones() {
    return (floorState.zones || []).filter((z) => {
      if (zoneKind(z.name) !== "dining") return false;
      if ((z.tables || []).length) return true;
      return isMainDiningZone(z.name);
    });
  }

  function terraceZones() {
    return (floorState.zones || []).filter((z) => (
      zoneKind(z.name) === "terrace" && (z.tables || []).length > 0
    ));
  }

  function clampPct(n, max) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return -1;
    return Math.max(0, Math.min(max, v));
  }

  function ensureXY(tables) {
    const list = tables || [];
    list.forEach((t, i) => {
      let x = Number(t.layout_x);
      let y = Number(t.layout_y);
      if (x >= 0 && y >= 0) {
        t.layout_x = clampPct(x, 92);
        t.layout_y = clampPct(y, 90);
        return;
      }
      const col = Number(t.layout_col);
      const row = Number(t.layout_row);
      if (col >= 0 && row >= 0) {
        t.layout_x = Math.round((col / 8) * 86 + 3);
        t.layout_y = Math.round((row / 3) * 68 + 5);
        return;
      }
      t.layout_x = 5 + (i % 7) * 12;
      t.layout_y = 8 + Math.floor(i / 7) * 16;
    });
    return list;
  }

  function msg(text, ok) {
    const el = document.getElementById("floor-plan-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok ? "var(--ngjyr-success,#16a34a)" : "var(--ngjyr-danger,#dc2626)";
  }

  function bindMapDrag(chip, table, mapEl) {
    let active = false;
    function point(ev) {
      const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      const r = mapEl.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      const chipW = (chip.offsetWidth / w) * 100;
      const chipH = (chip.offsetHeight / h) * 100;
      let x = ((e.clientX - r.left) / w) * 100 - chipW / 2;
      let y = ((e.clientY - r.top) / h) * 100 - chipH / 2;
      x = Math.max(0, Math.min(100 - chipW, x));
      y = Math.max(0, Math.min(100 - chipH, y));
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }
    function onMove(ev) {
      if (!active) return;
      ev.preventDefault();
      const p = point(ev);
      table.layout_x = p.x;
      table.layout_y = p.y;
      chip.style.left = p.x + "%";
      chip.style.top = p.y + "%";
    }
    function onUp() {
      if (!active) return;
      active = false;
      chip.classList.remove("is-dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      floorDirty = true;
      scheduleFloorSave();
    }
    chip.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      active = true;
      chip.classList.add("is-dragging");
      onMove(ev);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    chip.addEventListener("touchstart", (ev) => {
      active = true;
      chip.classList.add("is-dragging");
      onMove(ev);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
    }, { passive: true });
  }

  function chipEl(table, mapEl) {
    const wrap = document.createElement("div");
    wrap.className = "floor-chip";
    wrap.dataset.tableId = String(table.id);
    wrap.style.left = Number(table.layout_x) + "%";
    wrap.style.top = Number(table.layout_y) + "%";
    const name = document.createElement("span");
    name.className = "floor-chip-name";
    name.textContent = table.label || table.display_name || ("T" + table.number);
    const icon = document.createElement("span");
    icon.className = "floor-chip-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 11h10v2H7z"/><path d="M9 13v5M15 13v5M8 18h8"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/></svg>';
    const status = document.createElement("span");
    status.className = "floor-chip-status";
    status.textContent = "Lirë";
    wrap.appendChild(name);
    wrap.appendChild(icon);
    wrap.appendChild(status);
    bindMapDrag(wrap, table, mapEl);
    return wrap;
  }

  function boardEl(zone, kind) {
    zone.tables = ensureXY(zone.tables || []);
    const wrap = document.createElement("div");
    wrap.className = "floor-board";
    const head = document.createElement("div");
    head.className = "floor-board-head";
    const title = document.createElement("h3");
    title.className = "floor-board-title";
    title.textContent = zone.name || (kind === "terrace" ? "Terrasa" : "Restoranti");
    head.appendChild(title);
    wrap.appendChild(head);
    const map = document.createElement("div");
    map.className = "floor-map" + (kind === "terrace" ? " floor-map-terrace" : "");
    for (const t of zone.tables || []) {
      map.appendChild(chipEl(t, map));
    }
    wrap.appendChild(map);
    return wrap;
  }

  function renderBoards() {
    const diningWrap = document.getElementById("floor-dining-boards");
    const terraceWrap = document.getElementById("floor-terrace-boards");
    const terraceBox = document.getElementById("floor-terrace-box");
    const chk = document.getElementById("floor-terrasa-on");
    if (!diningWrap || !terraceWrap) return;
    diningWrap.innerHTML = "";
    terraceWrap.innerHTML = "";
    const dining = diningZones();
    if (!dining.length) {
      diningWrap.innerHTML = "<p class=\"floor-empty\">Shtoni tavolina te skeda Tavolinat.</p>";
    } else {
      for (const z of dining) diningWrap.appendChild(boardEl(z, "dining"));
    }
    const terrace = terraceZones();
    const showTerrace = !!floorState.terrasa_enabled || terrace.length > 0;
    if (chk) chk.checked = !!floorState.terrasa_enabled || terrace.length > 0;
    if (terraceBox) terraceBox.hidden = !showTerrace;
    if (showTerrace) {
      if (!terrace.length) {
        terraceWrap.innerHTML = "<p class=\"floor-empty\">Shtoni tavolina te skeda Tavolinat, te zona Terrasa.</p>";
      } else {
        for (const z of terrace) terraceWrap.appendChild(boardEl(z, "terrace"));
      }
    }
  }

  function scheduleFloorSave() {
    if (floorSaveTimer) clearTimeout(floorSaveTimer);
    floorSaveTimer = setTimeout(() => {
      floorSaveTimer = null;
      ruajRregullimiTavolinave();
    }, 250);
  }

  async function ngarkoRregullimiTavolinave() {
    if (floorDirty) {
      await ruajRregullimiTavolinave();
      return;
    }
    const msgEl = document.getElementById("floor-plan-msg");
    if (msgEl) msgEl.textContent = "";
    try {
      const data = await api("/api/admin/table-layout");
      floorState = {
        terrasa_enabled: !!data.terrasa_enabled,
        zones: (data.zones || []).map((z) => ({
          ...z,
          tables: (z.tables || []).map((t) => ({ ...t })),
        })),
      };
      if (terraceZones().length) floorState.terrasa_enabled = true;
      renderBoards();
    } catch (e) {
      msg(e.message || "Nuk u lexua vendosja.", false);
    }
  }

  async function ruajRregullimiTavolinave() {
    if (floorSaving) return;
    if (floorSaveTimer) {
      clearTimeout(floorSaveTimer);
      floorSaveTimer = null;
    }
    const chk = document.getElementById("floor-terrasa-on");
    const terrasa_enabled = !!(chk && chk.checked) || terraceZones().length > 0;
    floorState.terrasa_enabled = terrasa_enabled;
    const zones = [];
    for (const z of floorState.zones || []) {
      const kind = zoneKind(z.name);
      if (kind === "online") continue;
      if (kind === "terrace" && !terrasa_enabled && !(z.tables || []).length) continue;
      ensureXY(z.tables || []);
      const tables = (z.tables || []).map((t) => ({
        id: t.id,
        layout_x: Number(t.layout_x),
        layout_y: Number(t.layout_y),
        layout_col: Number(t.layout_col) || 0,
        layout_row: Number(t.layout_row) || 0,
      }));
      zones.push({ id: z.id, layout_rows: kind === "terrace" ? 2 : 3, tables });
    }
    floorSaving = true;
    floorDirty = false;
    try {
      await api("/api/admin/table-floor-plan", {
        method: "PUT",
        body: JSON.stringify({ terrasa_enabled, zones }),
      });
      msg("Vendosja u ruajt. Arka e tregon si këtu.", true);
    } catch (e) {
      floorDirty = true;
      msg(e.message || "Nuk u ruajt.", false);
    } finally {
      floorSaving = false;
      if (floorDirty) scheduleFloorSave();
    }
  }

  document.addEventListener("change", (ev) => {
    if (ev.target && ev.target.id === "floor-terrasa-on") {
      floorState.terrasa_enabled = !!ev.target.checked;
      floorDirty = true;
      renderBoards();
      scheduleFloorSave();
    }
  });

  document.addEventListener("click", (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest("#btn-floor-plan-save") : null;
    if (!btn) return;
    ruajRregullimiTavolinave();
  });

  window.ngarkoRregullimiTavolinave = ngarkoRregullimiTavolinave;
})();
