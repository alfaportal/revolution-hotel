Setup Windows — AUTO-PUBLISH (pa ndërhyrje manuale)

Rrjedha:
  1. Push tag vX.Y.Z te alfaportal/restaurant-system
  2. GitHub Actions (build-windows) ndërton Pako1–4 + KAFENE-Setup.exe
  3. Publikon KAFENE-Setup.exe te alfaportal/revolution-pos-server
     si release tag setup-vX.Y.Z  (secret: SETUP_PUBLISH_TOKEN)
  4. revolution-pos.com lexon automatikisht releases/latest (cache ~5 min)
     → /api/public/setup-download shërben versionin e ri

URL tipike e burimit intern:
  https://github.com/alfaportal/revolution-pos-server/releases/download/setup-vX.Y.Z/KAFENE-Setup.exe

Secret i nevojshëm (restaurant-system → Settings → Secrets):
  SETUP_PUBLISH_TOKEN = GitHub PAT me contents:write te revolution-pos-server

Override manual (vetëm nëse duhet pin i vjetër):
  SETUP_DOWNLOAD_PINNED=true
  SETUP_DOWNLOAD_URL=...
  SETUP_VERSION=X.Y.Z

Opsionale (Railway):
  SETUP_RELEASE_REPO=alfaportal/revolution-pos-server
  SETUP_RELEASE_CACHE_MS=300000

MOS përdor emrin «Sistemi i Kafenes Setup …» në URL — browseri / GitHub e bën 404.
