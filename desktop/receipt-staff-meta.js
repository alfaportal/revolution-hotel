/** Etiketa mysafir/QR në orders.waiter_name — jo emër stafi. */
function isGuestFacingWaiterLabel(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return true;
  return (
    /mysafir|takeaway|porosi online|web-public|web-guest|web-kiosk/.test(n)
    || n.startsWith("qr")
    || n.includes("room service")
    || n.includes("minibar")
    || n.includes("shërbim hoteli")
    || n.includes("sherbim hoteli")
  );
}

/**
 * Kamarieri (shërbimi) vs punonjësi që mbyll/merr pagesën — për faturë termike/fiskale.
 */
function receiptStaffFields(order, closingName) {
  const closing = String(closingName || "").trim();
  const orderWaiter = String(order?.waiter_name || "").trim();
  const source = String(order?.source_label || "").trim();

  if (isGuestFacingWaiterLabel(orderWaiter)) {
    return {
      waiterName: closing || orderWaiter || "Stafi",
      acceptedBy: closing || "",
      paymentBy: closing || "",
      guestContext: source || orderWaiter,
    };
  }
  return {
    waiterName: orderWaiter || closing,
    acceptedBy: closing && !sameStaffName(closing, orderWaiter) ? closing : "",
    paymentBy: closing || orderWaiter,
    guestContext: source,
  };
}

function sameStaffName(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

module.exports = {
  isGuestFacingWaiterLabel,
  receiptStaffFields,
};
