const express = require("express");
const { getClientBySlugOrId } = require("../lib/kitchenAccess");
const { getKioskMenu } = require("../services/kioskService");

const router = express.Router();

function readGuestSlug(req) {
  return String(req.query.slug || req.query.kitchen_slug || "").trim();
}

async function resolveGuestClient(req) {
  const slug = readGuestSlug(req);
  if (!slug) return null;
  return getClientBySlugOrId(slug);
}

function mapMenuItem(item) {
  return {
    id: item.id,
    name: item.name || item.emri || "",
    price: Number(item.price ?? item.cmimi ?? 0) || 0,
    category: item.category || "",
    photo_src: item.photo_src || item.photo || "",
  };
}

router.get("/menu", async (req, res) => {
  try {
    const client = await resolveGuestClient(req);
    if (!client) {
      return res.json({
        ok: true,
        source: "restaurant_menu",
        hotel_name: "Hotel",
        categories: [],
        items: [],
      });
    }
    const menu = await getKioskMenu(client.id, {
      kitchenSlug: client.kitchen_slug,
      channel: "menu",
    });
    const categories = menu.categories || [];
    const items = (menu.items || []).map(mapMenuItem);
    res.json({
      ok: true,
      source: "restaurant_menu",
      hotel_name: client.emri || "Hotel",
      categories,
      items,
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim" });
  }
});

/** Shërbime hoteli — katalogu cloud vjen nga sync POS (SQLite → Supabase) në fazë tjetër. */
router.get("/services", async (req, res) => {
  try {
    const client = await resolveGuestClient(req);
    res.json({
      ok: true,
      source: "hotel_services",
      hotel_name: client?.emri || "Hotel",
      groups: [],
      categories: [],
      services: [],
      info: client
        ? "Katalogu i shërbimeve (spa, bazen…) ende nuk është sinkronizuar në cloud. Shtoni shërbime në POS dhe prisni sync."
        : "Mungon slug në QR. Rifreskoni QR nga Admin → Cloud.",
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message || "Gabim" });
  }
});

router.get("/menu/:id/photo", (_req, res) => {
  res.status(404).end();
});

router.get("/services/:id/photo", (_req, res) => {
  res.status(404).end();
});

router.post("/menu-order", (_req, res) => {
  res.status(501).json({
    gabim: "Porosi menu nga QR cloud — përdorni /hotel/menu/{slug}/{tavolina} ose room service pas sync.",
  });
});

router.post("/service-order", (_req, res) => {
  res.status(501).json({
    gabim: "Porositë e shërbimeve në cloud aktivizohen pas sync të katalogut nga POS.",
  });
});

router.post("/room-order", (_req, res) => {
  res.status(501).json({ gabim: "Nuk mbështetet ende në cloud." });
});

module.exports = router;
