/** Foto standarde lokale për shërbimet e hotelit — offline (/service-stock/). */
function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c");
}

const SERVICE_PHOTOS = {
  [normName("Bazen")]: "/service-stock/bazen.jpg",
  [normName("Sauna")]: "/service-stock/sauna.jpg",
  [normName("Xhakuzi")]: "/service-stock/xhakuzi.jpg",
  [normName("Palestra / Gym")]: "/service-stock/gym.jpg",
  [normName("Palestra/Gym")]: "/service-stock/gym.jpg",
  [normName("Masazh")]: "/service-stock/masazh.jpg",
  [normName("Facial")]: "/service-stock/facial.jpg",
  [normName("Spa")]: "/service-stock/facial.jpg",
  [normName("Manikyr")]: "/service-stock/manikyr.jpg",
  [normName("Pedikyr")]: "/service-stock/pedikyr.jpg",
  [normName("Minibar")]: "/service-stock/minibar.jpg",
  [normName("Room Service")]: "/service-stock/room-service.jpg",
  [normName("Shtrat shtesë")]: "/service-stock/shtrat-shtese.jpg",
  [normName("Zgjatje qëndrimi")]: "/service-stock/zgjatje-qendrimi.jpg",
  [normName("Larje robash / Laundry")]: "/service-stock/laundry.jpg",
  [normName("Laundry")]: "/service-stock/laundry.jpg",
  [normName("Hekurosje")]: "/service-stock/hekurosje.jpg",
  [normName("Pastrim i thatë")]: "/service-stock/pastrim-thate.jpg",
  [normName("Parking")]: "/service-stock/parking.jpg",
  [normName("Transfer aeroport")]: "/service-stock/transfer-aeroport.jpg",
  [normName("Marrje me veturë")]: "/service-stock/marrje-veture.jpg",
  [normName("Wi-Fi Premium")]: "/service-stock/wifi.jpg",
  [normName("Late check-out")]: "/service-stock/late-checkout.jpg",
  [normName("Early check-in")]: "/service-stock/early-checkin.jpg",
  [normName("Salla e Konferencave (ora)")]: "/service-stock/salla-konferenca.jpg",
  [normName("Salla e Konferencave (dita)")]: "/service-stock/salla-konferenca.jpg",
  [normName("Salla e Konferencave")]: "/service-stock/salla-konferenca.jpg",
  [normName("Projektor")]: "/service-stock/projektor.jpg",
  [normName("Sistem zanor / Mikrofon")]: "/service-stock/mikrofon.jpg",
  [normName("Mikrofon")]: "/service-stock/mikrofon.jpg",
};

const CATEGORY_PHOTOS = {
  [normName("Rekreacion")]: "/service-stock/cat-rekreacion.jpg",
  [normName("Wellness & Spa")]: "/service-stock/cat-wellness.jpg",
  [normName("Dhomë")]: "/service-stock/cat-dhome.jpg",
  [normName("Pastrim & Veshje")]: "/service-stock/cat-pastrim.jpg",
  [normName("Transport")]: "/service-stock/cat-transport.jpg",
  [normName("Sallat e Konferencave")]: "/service-stock/cat-konferenca.jpg",
  [normName("Salla e Konferencave")]: "/service-stock/cat-konferenca.jpg",
  [normName("Konferenca")]: "/service-stock/cat-konferenca.jpg",
  [normName("Të tjera")]: "/service-stock/cat-te-tjera.jpg",
};

function stockPhotoForServiceName(name) {
  return SERVICE_PHOTOS[normName(name)] || "";
}

function stockPhotoForCategoryName(name) {
  return CATEGORY_PHOTOS[normName(name)] || "";
}

function isRemotePhoto(val) {
  return /^https?:\/\//i.test(String(val || "").trim());
}

function isServiceStockPhoto(val) {
  const s = String(val || "").trim();
  if (!s) return false;
  if (isRemotePhoto(s)) return true;
  return s.startsWith("/service-stock/");
}

/**
 * Mbush foto të zbrazëta për shërbimet (nuk prish foto custom).
 */
function applyMissingServicePhotos(db, { forceAllStock = false } = {}) {
  let n = 0;
  const rows = typeof db.listHotelServices === "function"
    ? db.listHotelServices({ activeOnly: false })
    : [];
  for (const item of rows) {
    const local = stockPhotoForServiceName(item.name);
    if (!local) continue;
    const current = String(item.photo || "").trim();
    if (!forceAllStock && current) continue;
    if (current !== local) {
      db.setHotelServicePhoto(item.id, local);
      n++;
    }
  }
  return n;
}

/**
 * Mbush foto të zbrazëta për kategoritë (nuk prish foto custom).
 * Kategoritë i shfaqim me foto reale, ndaj emoji nuk përdoret më në ekran.
 */
function applyMissingCategoryPhotos(db, { forceAllStock = false } = {}) {
  let n = 0;
  const rows = typeof db.listHotelServiceCategories === "function"
    ? db.listHotelServiceCategories()
    : [];
  for (const cat of rows) {
    const local = stockPhotoForCategoryName(cat.name);
    if (!local) continue;
    const current = String(cat.photo || "").trim();
    if (!forceAllStock && current) continue;
    if (current !== local && typeof db.setHotelServiceCategoryPhoto === "function") {
      db.setHotelServiceCategoryPhoto(cat.id, local);
      n++;
    }
  }
  return n;
}

module.exports = {
  stockPhotoForServiceName,
  stockPhotoForCategoryName,
  applyMissingCategoryPhotos,
  applyMissingServicePhotos,
  isServiceStockPhoto,
  SERVICE_PHOTOS,
  CATEGORY_PHOTOS,
  normName,
};
