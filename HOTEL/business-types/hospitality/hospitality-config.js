/**
 * hospitality — hotel / restorant / bar
 * Cilët module aktivizohen për këtë lloj biznesi.
 * NUK zhvendos kod ekzistues — vetëm konfigurim.
 */
module.exports = {
  businessType: "hospitality",
  labels: ["hotel", "restorant", "bar"],
  modules: {
    tables: true,
    orders: true,
    register: true,
    thermalPrinter: true,
    waiters: true,
    qrOrders: true,
    stock: true,
    promotions: true,
    reportsXZ: true,
    dailySummary: true,
    kds: true,
    rfid: true,
    accountant: true,
    expenses: true,
    voidWithReason: true,
    auditTrail: true,
    registerToggle: true,
    ai: true, // vetëm kur package-tier = pako_4
  },
};
