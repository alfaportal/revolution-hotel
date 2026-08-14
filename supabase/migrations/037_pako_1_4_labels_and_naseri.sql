-- Pako 1–4 (marketing) = pako_2 … pako_5 në backend.
-- pako_1 mbetet vetëm për klientë legacy.

COMMENT ON COLUMN clients.package_tier IS
  'pako_2=Pako1, pako_3=Pako2, pako_4=Pako3 (porosi online), pako_5=Pako4 (AI), pako_1=legacy';

-- Naseri përdor QR, kamarier, faqe publike dhe porosi online — Pako 4 (pako_5).
UPDATE clients
SET package_tier = 'pako_5'
WHERE kitchen_slug = 'naseri-77a7dd'
   OR (LOWER(TRIM(emri)) = 'naseri' AND package_tier IN ('pako_2', 'pako_3'));
