"use strict";
/**
 * Të dhëna për panelin e pronarit (telefon) — dërgohen në cloud te payload.owner_panel.
 */
const { buildHotelQrUrls, resolveQrBaseUrl, resolveHotelQrSlug, isCloudQrBase } = require("./hotel-qr-service");

function fixRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function departmentLabel(staffRole) {
  const r = String(staffRole || "").trim().toLowerCase();
  if (r === "recepsion" || r === "receptionist") return "Recepsion";
  return "Restorant";
}

function hkStatusLabel(hk) {
  const s = String(hk || "").toLowerCase();
  if (s === "dirty") return "Për pastrim";
  if (s === "in_progress") return "Në pastrim";
  if (s === "maintenance") return "Jashtë shërbimit";
  if (s === "occupied") return "Mysafir në dhomë";
  return "E pastruar";
}

function buildHousekeepingForPanel(db) {
  if (typeof db.listHousekeepingBoard !== "function") return { rooms: [], counts: {} };
  const board = db.listHousekeepingBoard();
  const rooms = (board.rooms || []).map((r) => ({
    room_number: r.room_number,
    floor: r.floor,
    hk_status: r.hk_status,
    hk_label: hkStatusLabel(r.hk_status),
    assigned_name: r.assigned_name || "",
  }));
  return { rooms, counts: board.counts || {} };
}

function buildQrVenuesForPanel(db) {
  const slug = resolveHotelQrSlug(db);
  const configuredBase = resolveQrBaseUrl(db);
  const useCloud = isCloudQrBase(configuredBase) && !!slug;
  if (!useCloud) {
    return { configured: false, hotel_slug: slug || "", venues: [] };
  }
  const list = typeof db.listHotelQrVenues === "function"
    ? db.listHotelQrVenues({ activeOnly: true })
    : [];
  const venues = list.map((v) => {
    const spotOpts = { tableNumber: v.table_number, venueCode: v.venue_code };
    const urls = buildHotelQrUrls(configuredBase, "", slug, spotOpts);
    const label =
      typeof db.formatHotelQrVenueLabel === "function"
        ? db.formatHotelQrVenueLabel(v)
        : `${v.name} ${v.table_number}`;
    return {
      venue_id: v.id,
      name: v.name,
      table_number: v.table_number,
      label,
      page_url: urls.services || urls.menu || "",
    };
  });
  return { configured: true, hotel_slug: slug, base_url: configuredBase, venues };
}

function buildTerminalsForPanel(db) {
  if (typeof db.getAdminRegisterStatus !== "function") {
    return { registers: [], pending_room_charges_total: 0 };
  }
  const st = db.getAdminRegisterStatus();
  let pendingRoomTotal = 0;
  const registers = (st.registers || []).map((r) => {
    const remote = !!r.remote;
    const rs = r.remote_status || {};
    const pendingRoom = Math.max(0, Math.floor(Number(rs.pending_room_charges) || 0));
    pendingRoomTotal += pendingRoom;
    const connected = remote ? !!r.remote_online : true;
    let roleLabel = "Kryesorja";
    if (remote || Number(r.number) >= 2) roleLabel = "Arka 2";
    else if (Number(r.number) > 1) roleLabel = `Arka ${r.number}`;
    return {
      register_id: r.id,
      label: roleLabel,
      name: r.name,
      number: r.number,
      connected,
      status: r.status === "open" ? "Hapur" : "Mbyllur",
      staff_name: r.staff_name || "",
      pending_room_charges: pendingRoom,
      pending_queue: Math.max(0, Math.floor(Number(rs.pending) || 0)),
      remote_ip: r.remote_ip || "",
    };
  });
  if (pendingRoomTotal === 0 && typeof db.getCheckoutPendingRoomChargeWarning === "function") {
    try {
      const w = db.getCheckoutPendingRoomChargeWarning();
      pendingRoomTotal = Math.max(0, Math.floor(Number(w?.pending_count) || 0));
    } catch {
      /* ignore */
    }
  }
  return {
    date: st.date,
    registers,
    pending_room_charges_total: pendingRoomTotal,
  };
}

function buildB2bForPanel(db) {
  let invoices = [];
  let debts = [];
  try {
    const svc = require("./sales-invoices-service");
    if (typeof svc.listInvoices === "function") {
      invoices = svc.listInvoices({ limit: 80 }).map((inv) => {
        const grand = Number(inv.totals?.grandTotal ?? inv.grand_total) || 0;
        const paid = Number(inv.amountPaid ?? inv.amount_paid) || 0;
        return {
          id: inv.id,
          number: inv.number,
          date: inv.date,
          company_name:
            inv.guest?.kind === "company"
              ? inv.guest.companyName || inv.guest.name
              : inv.guest?.name || "",
          grand_total: fixRound(grand),
          amount_paid: fixRound(paid),
          balance_due: fixRound(Math.max(0, grand - paid)),
          payment_status: inv.paymentStatus || inv.payment_status || "unpaid",
        };
      });
    }
    if (typeof svc.listBusinessDebts === "function") {
      debts = svc.listBusinessDebts();
    }
  } catch (e) {
    console.warn("[owner_panel] b2b:", e.message);
  }
  return { invoices, debts_by_business: debts };
}

function buildOwnerPanelSnapshot(db) {
  return {
    housekeeping: buildHousekeepingForPanel(db),
    qr_venues: buildQrVenuesForPanel(db),
    terminals: buildTerminalsForPanel(db),
    b2b: buildB2bForPanel(db),
  };
}

module.exports = {
  buildOwnerPanelSnapshot,
  departmentLabel,
  hkStatusLabel,
};
