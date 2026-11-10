document.addEventListener("DOMContentLoaded", async () => {
  const box = document.getElementById("kasa-grant-tabs");
  if (!box || typeof lexoSesionin !== "function" || typeof api !== "function") return;
  const u = lexoSesionin();
  if (!u || !u.staff_id || (u.roli !== "kamarier" && u.roli !== "recepsion")) return;
  try {
    const data = await api(`/api/staff/${u.staff_id}/tab-permissions`);
    const allowed = (data.permissions || []).filter((p) => Number(p.allowed) === 1);
    if (!allowed.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = allowed
      .map((p) => {
        const label = String(p.label || p.tab_key)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const key = String(p.tab_key).replace(/"/g, "");
        return `<button type="button" class="kasa-top-tab" data-open-tab="${key}">${label}</button>`;
      })
      .join("");
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open-tab]");
      if (!b) return;
      location.href = "/admin.html?tab=" + encodeURIComponent(b.dataset.openTab);
    });
  } catch {
    box.hidden = true;
  }
});
