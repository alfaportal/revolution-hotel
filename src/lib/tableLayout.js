const MAX_TABLES = 30;

function buildTablesFromAreas(areas, fallbackTableCount, activeByTable) {
  const activeAreas = (areas || [])
    .filter(a => a.active !== false)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  const allTables = [];
  const areaGroups = [];

  if (activeAreas.length) {
    let number = 1;
    for (const area of activeAreas) {
      const count = Math.min(MAX_TABLES, Math.max(0, Number(area.table_count) || 0));
      const tables = [];
      for (let i = 0; i < count && number <= MAX_TABLES; i += 1, number += 1) {
        const active = activeByTable?.get?.(number);
        tables.push({
          number,
          area_id: area.id,
          area_name: area.name,
          status: active ? "occupied" : "free",
          waiter_name: active?.waiter_name || null,
          waiter_id: active?.waiter_id || null,
          order_total: active ? Number(active.total) : 0,
          active_items: active?.active_items || [],
          device_id: active?.device_id || null,
          accepted_by_waiter_id: active?.accepted_by_waiter_id || null,
          accepted_by_waiter_name: active?.accepted_by_waiter_name || null,
        });
      }
      if (tables.length) {
        areaGroups.push({ id: area.id, name: area.name, tables });
        allTables.push(...tables);
      }
    }
  } else {
    const count = Math.min(MAX_TABLES, Math.max(1, Number(fallbackTableCount) || 10));
    for (let number = 1; number <= count; number += 1) {
      const active = activeByTable?.get?.(number);
      allTables.push({
        number,
        area_id: null,
        area_name: null,
        status: active ? "occupied" : "free",
        waiter_name: active?.waiter_name || null,
        waiter_id: active?.waiter_id || null,
        order_total: active ? Number(active.total) : 0,
        active_items: active?.active_items || [],
        device_id: active?.device_id || null,
        accepted_by_waiter_id: active?.accepted_by_waiter_id || null,
        accepted_by_waiter_name: active?.accepted_by_waiter_name || null,
      });
    }
    if (allTables.length) {
      areaGroups.push({ id: null, name: "Tavolinat", tables: allTables });
    }
  }

  return {
    tables: allTables,
    areas: areaGroups,
    table_count: allTables.length,
  };
}

module.exports = {
  MAX_TABLES,
  buildTablesFromAreas,
};
