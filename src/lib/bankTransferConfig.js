/**
 * Pagesë bankare (Kosovë) — vetëm të dhëna publike për transfer.
 * Pa IBAN, pa të dhëna personale.
 */
const BANK_TRANSFER = {
  company: "REVOLUTION INVEST SH.P.K.",
  bank: "Raiffeisen Bank Kosovo",
  account: "1504001010467891",
  currency: "EUR",
  nui: "811314567",
};

function getBankTransferPublic() {
  return { ...BANK_TRANSFER };
}

module.exports = {
  BANK_TRANSFER,
  getBankTransferPublic,
};
