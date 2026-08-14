function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isExpired(dateStr) {
  if (!dateStr) return true;
  return dateStr < todayISO();
}

function addMonthsISO(startDate, months) {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addMonthsTimestamp(startDate, months) {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

module.exports = {
  todayISO,
  isExpired,
  addMonthsISO,
  addMonthsTimestamp,
};
