# CLAUDE.md

## RREGULL I DETYRUESHËM — LEXO PARA ÇFARËDO PUNE

### 1. LEXO RREGULLAT
Para se të bësh ÇFARËDO ndryshimi, LEXO PLOTËSISHT këtë skedar DHE .cursorrules (nëse ekziston).
Nëse nuk i lexon — NDALO dhe lexoji. Pa përjashtim.

### 2. MOS PREK PA LEJE — TELEFONI DHE PANELI I ADMINIT
Kodet e telefonit (waiter.js, mobile, cloud waiter) DHE panelit të adminit (admin.html, admin JS, tab-et, UI admin) janë ZONA TË MBROJTURA.
NUK GUXON me bë ASNJË ndryshim në këto zona pa lejen KONKRETE dhe DYHERE të Naserit.
- Herë e parë: Naser thotë "po bëje"
- Herë e dytë: Naser konfirmon përsëri "po, vazhdo"
Pa këto dy konfirmime — MOS PREK. Edhe nëse mendon se duhet ndryshim. Edhe nëse bug-u është aty. Pyet, mos prek.

### 3. MOS BO BUILD PA LEJE
Nuk guxon me bo build përveç nëse Naser thotë qartë "build" ose "bëje build".

### 4. MOS PREK LINKAT, CLOUD, SINKRONIZIMIN DHE TELEFONIN
Linkat e telefonit, sinkronizimi cloud, URL-të e serverave, bridge-at, secrets, dhe çdo lidhje mes projekteve janë ZONA TË MBROJTURA ABSOLUTISHT.
NUK GUXON me bë ASNJË ndryshim në:
- URL të serverave (Railway, Supabase, upstream)
- Bridge-at mes telefonit dhe serverave (marketAdminBridge, hotelAdminBridge, etj.)
- Secrets / API keys (ADMIN_SECRET, SUPER_ADMIN_SECRET, etj.)
- Endpoint-et e licencës (/api/v1/license/*, /api/license/*, etj.)
- Cloud sync (sinkronizim, heartbeat, watchdog, SSE, polling)
- Lidhjet mes projekteve
PA LEJEN KONKRETE dhe DYHERE të Naserit. Pa përjashtim.

### 5. KREJT PROJEKTET SHKOJNË PËRMES revolution-pos.com
- Çdo projekt (KAFENE, MARKET, HOTEL, FURRA, FISKALIZIME, SECURITY, KONTABILISTI) ka serverin e vet
- Por krejt linkat e telefonit shkojnë përmes revolution-pos.com (revolution-restaurant-server)
- Nuk lejohet me ndryshu këtë arkitekturë
- Nuk lejohet me kriju lidhje të reja mes serverave pa leje
- Nuk lejohet me përzier projektet (klientët e njërit nuk shkojnë te tjetri)
- Çdo projekt i ri që vjen — shkon përmes revolution-pos.com njëlloj si të tjerët

---

## RREGULLI #0 (E PËRJETSHME) — ZERO CLOUD / ZERO INTERNET
**NDALOHET: Zero Supabase, zero cloud, zero server i jashtëm. Vetëm SQLite lokal. Kjo rregull nuk ndryshohet pa miratimin eksplicit të pronarit.**

- Është E NDALUAR lidhja me Supabase, cloud, Railway, revolution-pos.com, ose çdo server të jashtëm.
- Hoteli (hotel-system / Revolution HOTEL) punon VETËM me SQLite lokal.
- Mos shto URL, API keys, sync, ose thirrje rrjeti për cloud derisa pronari ta lejojë eksplicitisht me shkrim.
- Kjo nuk ndryshon «përkohësisht» dhe nuk anashkalohet me env / fallback / «vetëm test».

## RREGULLI #1 (KRYESORE) — MBROJTJA ANTI-VJEDHJE
ASNJËHERË mos thyaj / mos dobëso mbrojtjet: asar, Electron fuses, obfuscation (`npm run build`), DevTools off në prod, `integrity-check`, `security-alert` (njoftime), hardware-lock license, pre-commit + pre-build gates.
ASNJËHERË Setup për klient / USB / uebsajt pa obfuscation (`build:plain` vetëm debug lokal).
Detaje: `.cursorrules` → **RREGULLI #1**.

---

Protected functions exist — read PROTECTED-FUNCTIONS.md before making ANY changes to database.js, server.js, or cloud-sync.js.

A pre-commit hook and `npm run build` both run `tests/protected-functions.test.js` automatically; a failing test blocks the commit/build.
