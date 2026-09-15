function formatError(err) {
  if (!err) return "Gabim i panjohur";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.details) return err.details;
  if (err.hint) return err.hint;
  if (err.code) return `Gabim DB (${err.code})`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function logRouteError(label, err, extra = {}) {
  const msg = formatError(err);
  console.error(`[${label}]`, msg, {
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
    ...extra,
  });
  return msg;
}

module.exports = { formatError, logRouteError };
