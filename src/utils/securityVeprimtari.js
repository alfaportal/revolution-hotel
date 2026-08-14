/**
 * REVOLUTION SECURITY — biznese që MENAXHOJNË punëtorë në terren.
 * Nuk përzihen kurrë me REVOLUTION POS (shitje ushqim/pije).
 */

const SECURITY_VEPRIMTARI = [
  { id: "kompani_sigurie", label: "Kompani sigurie (roje, patrullime)" },
  { id: "pastrim", label: "Kompani pastrimi (pastrues nëpër objekte)" },
  { id: "ndertimtari", label: "Ndërtimtari (punëtorë kantiere)" },
  { id: "transport_logjistike", label: "Transport / Logjistikë (shoferë, dërgesa)" },
  { id: "sherbime_teknike", label: "Shërbime teknike (elektricistë, hidraulikë, servis)" },
  { id: "mirembajtje_nderte", label: "Mirëmbajtje ndërtesash (maintenance)" },
  { id: "agjenci_punesimi", label: "Agjenci punësimi (punëtorë të dërguar te klientët)" },
  { id: "bujqesi", label: "Bujqësi (punëtorë sezone)" },
  { id: "kuriere_dergesa", label: "Kurierë / Dërgesa" },
];

/** Sektoret e listës Klientët (Security) — një sektor për çdo veprimtari. */
const SECURITY_SECTORS = SECURITY_VEPRIMTARI.map((v, i) => ({
  num: i + 1,
  id: `sec_${v.id}`,
  label: v.label,
  tipet: [v.id],
  keywords: [v.id, ...String(v.label).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)],
}));

const VEPRIMTARI_ALIASES = {
  transport: "transport_logjistike",
  transport_sigurie: "transport_logjistike",
  logjistike: "transport_logjistike",
  kuriere: "kuriere_dergesa",
  dergesa: "kuriere_dergesa",
  courier: "kuriere_dergesa",
  maintenance: "mirembajtje_nderte",
  mirembajtje: "mirembajtje_nderte",
  // vlera të vjetra → më e afërta / ose mbeten si tjeter në UI të vjetër
  retail: "kompani_sigurie",
  retail_sigurie: "kompani_sigurie",
  hotel_restorant: "kompani_sigurie",
  hotel: "kompani_sigurie",
  objekt: "mirembajtje_nderte",
  event_sigurie: "kompani_sigurie",
  parking: "kompani_sigurie",
  fabrika: "ndertimtari",
  shkolla: "mirembajtje_nderte",
  spitale: "mirembajtje_nderte",
  banka: "kompani_sigurie",
  sherbime_mjekesore: "sherbime_teknike",
  tjeter: "kompani_sigurie",
};

function normalizeVeprimtari(raw) {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/\s+/g, "_")
    .replace(/\//g, "_");
  if (!s) return "kompani_sigurie";
  if (VEPRIMTARI_ALIASES[s]) s = VEPRIMTARI_ALIASES[s];
  if (SECURITY_VEPRIMTARI.some((v) => v.id === s)) return s;
  return "kompani_sigurie";
}

function labelForVeprimtari(id) {
  const n = normalizeVeprimtari(id);
  return SECURITY_VEPRIMTARI.find((v) => v.id === n)?.label || id || "Security";
}

function sectorForVeprimtari(veprimtari) {
  const t = normalizeVeprimtari(veprimtari);
  for (const s of SECURITY_SECTORS) {
    if (s.tipet.includes(t)) return s;
  }
  return SECURITY_SECTORS[0];
}

module.exports = {
  SECURITY_VEPRIMTARI,
  SECURITY_SECTORS,
  normalizeVeprimtari,
  labelForVeprimtari,
  sectorForVeprimtari,
};
