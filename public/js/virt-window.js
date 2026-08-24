/** Dritare virtuale — mos i krijo të gjitha kartelat/rreshtat njëherësh (100+). */
(function (global) {
  const THRESHOLD = 100;
  const PAGE = 60;

  function renderWindowed(container, items, renderItem, opts) {
    if (!container) return;
    const threshold = opts && opts.threshold != null ? opts.threshold : THRESHOLD;
    const pageSize = opts && opts.pageSize != null ? opts.pageSize : PAGE;
    container.innerHTML = "";
    if (!items || !items.length) return;

    if (items.length <= threshold || (opts && opts.forceAll)) {
      const frag = document.createDocumentFragment();
      for (const it of items) frag.appendChild(renderItem(it));
      container.appendChild(frag);
      return;
    }

    let shown = Math.min(pageSize, items.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < shown; i++) frag.appendChild(renderItem(items[i]));
    container.appendChild(frag);

    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn btn-ghost virt-more-btn";
    more.style.cssText = "grid-column:1/-1;margin:0.5rem 0;width:100%";
    function paintMoreLabel() {
      more.textContent = `Shfaq më shumë (${shown} / ${items.length})`;
    }
    paintMoreLabel();
    more.addEventListener("click", () => {
      const next = Math.min(shown + pageSize, items.length);
      const extra = document.createDocumentFragment();
      for (let i = shown; i < next; i++) extra.appendChild(renderItem(items[i]));
      container.insertBefore(extra, more);
      shown = next;
      if (shown >= items.length) more.remove();
      else paintMoreLabel();
    });
    container.appendChild(more);
  }

  function renderTableRows(tbody, rowHtmlList, emptyHtml, opts) {
    if (!tbody) return;
    const threshold = opts && opts.threshold != null ? opts.threshold : THRESHOLD;
    const pageSize = opts && opts.pageSize != null ? opts.pageSize : 80;
    const rows = rowHtmlList || [];
    if (!rows.length) {
      tbody.innerHTML = emptyHtml || "";
      return;
    }
    if (rows.length <= threshold || (opts && opts.forceAll)) {
      tbody.innerHTML = rows.join("");
      return;
    }
    let shown = Math.min(pageSize, rows.length);
    function paint() {
      const extra = shown < rows.length
        ? `<tr class="virt-more-row"><td colspan="12"><button type="button" class="btn btn-ghost virt-more-btn">Shfaq më shumë (${shown} / ${rows.length})</button></td></tr>`
        : "";
      tbody.innerHTML = rows.slice(0, shown).join("") + extra;
      tbody.querySelector(".virt-more-btn")?.addEventListener("click", () => {
        shown = Math.min(shown + pageSize, rows.length);
        paint();
      });
    }
    paint();
  }

  global.VirtWindow = { renderWindowed, renderTableRows, THRESHOLD };
})(typeof window !== "undefined" ? window : globalThis);
