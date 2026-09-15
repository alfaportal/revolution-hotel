/** Llogaritje ditësh për skadimin e provës (trial_ends_at). */

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysUntilTrialEnd(trialEndsAt) {
  if (!trialEndsAt) return null;
  const end = startOfUtcDay(new Date(trialEndsAt));
  const today = startOfUtcDay(new Date());
  return Math.round((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function formatTrialDateSq(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("sq-AL", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

module.exports = {
  daysUntilTrialEnd,
  formatTrialDateSq,
};
