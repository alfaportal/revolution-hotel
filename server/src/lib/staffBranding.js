const { getSupabase } = require("../db");

async function getStaffBrandingForClient(client, slug = "") {
  const db = getSupabase();
  const clientId = client?.id;
  const slugSafe = String(slug || client?.kitchen_slug || "").trim();

  let settings = null;
  if (clientId) {
    const { data } = await db
      .from("pos_settings")
      .select("restaurant_name, address, public_logo")
      .eq("client_id", clientId)
      .maybeSingle();
    settings = data;
  }

  const restaurantName = String(settings?.restaurant_name || client?.emri || "").trim();
  const address = String(settings?.address || "").trim();

  return {
    client_name: client?.emri || "",
    restaurant_name: restaurantName || client?.emri || "",
    address,
    logo_url: settings?.public_logo && slugSafe ? `/api/r/${encodeURIComponent(slugSafe)}/logo` : null,
    revolution_logo_url: "/logo-source.png",
  };
}

module.exports = { getStaffBrandingForClient };
