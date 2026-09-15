(function (global) {
  function getCategoryList(bootstrap) {
    if (bootstrap.categories?.length) return bootstrap.categories;
    return [...new Set((bootstrap.menu || []).map(m => m.category).filter(Boolean))];
  }

  function pickDefaultCategory(bootstrap) {
    const cats = getCategoryList(bootstrap);
    if (!cats.length) return "";
    const withItems = cats.find(c => (bootstrap.menu || []).some(m => m.category === c));
    return withItems || cats[0] || "";
  }

  function filterMenuItems(bootstrap, activeCategory) {
    const menu = bootstrap.menu || [];
    let category = activeCategory;
    let items = menu.filter(m => !category || m.category === category);
    if (!items.length && menu.length) {
      category = pickDefaultCategory(bootstrap);
      items = menu.filter(m => !category || m.category === category);
    }
    return { items, category };
  }

  global.MenuCatalog = {
    getCategoryList,
    pickDefaultCategory,
    filterMenuItems,
  };
})(typeof window !== "undefined" ? window : globalThis);
