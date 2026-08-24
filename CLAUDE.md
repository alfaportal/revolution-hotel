# CLAUDE.md

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
