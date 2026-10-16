# PUNA.md — HOTEL desktop

## 2026-10-11 — Dita e biznesit (Europe/Belgrade) — **IMPLEMENTUAR**

**Rregull:** `Europe/Belgrade` (Kosovë) për **dita e biznesit** në lexim/raporte/sync — PC + cloud. **`daily_log` INSERT** mbetet `date('now','localtime')` (ora Windows). **Jo** ndryshim Z-raport / ATK PDF (`server.js` ~6923 `createDate` UTC).

### Helper

| Vend | Skedar |
|------|--------|
| PC Node | `lib/hotel-business-date.js` — `businessYmd`, `businessYesterdayYmd`, `addBusinessDays`, `pcTimezoneMismatchWarning` |
| PC browser | `public/js/hotel-business-date.js` + `app.js` `sotISO()` / `addDaysISO()` |
| Cloud | `revolution-hotel-server/src/lib/hotelBusinessDate.js` + `public/js/hotel-business-date.js` |

### PC (desktop)

- `database.js` — raporte, ditari, COGS, bilanc, blerje 30d
- `server.js` — queue snapshot pas shift/checkout, eksporte CSV/txt, kontabilisti PDF range; `GET /api/settings` → `pc_timezone.warning`
- `owner-report-sync.js`, `owner-report-snapshot.js`, `owner-report-analytics.js`, `stock-breakage-loss.js`
- `promotion-service.js`, `ingredient-stock-count.js`, `cloud-sync.js` (since sot)
- `public/admin.html` — default datash + banner `#pc-timezone-banner`

### Cloud (`revolution-hotel-server`)

- `morningOwnerAiReportService.js`, `hotelPcSnapshotAi.js`, `ownerDailyReportService.eachDay`
- `salesService.js` `dateRanges` / `getOwnerReport`
- `routes/owner.js` default datë; `public/js/owner.js` + panel script
- Test: `scripts/test-hotel-business-date.js`

### Provë 00:30 Kosovë (sim)

`node tests/hotel-business-date.test.js` — `2026-10-10T22:30:00Z` → `businessYmd` = **2026-10-11**, dje = **2026-10-10**.

### Audit / suite

`node tests/run-all.js` (11 suite, përfshirë `hotel-business-date.test.js`); `node tmp-hotel-accounting-real-path-audit.js` → **15/16 PO**.

### Release 2026-10-11 (Naseri OK)

| Hapi | Rezultat |
|------|----------|
| **Git desktop** | `5de6881` → `origin/master` (revolution-hotel) |
| **Git cloud** | `8e9453e` → Railway (`/hotel/health` `git_commit` 8e9453e) |
| **Setup** | **1.0.602 → 1.0.603** — `dist/Revolution HOTEL Setup.exe` + kopje Desktop |

**Instalo:** Setup i ri → mbyll HOTEL plotësisht → hape përsëri.

---

## 2026-10-11 — Dita e biznesit — inventar i vjetër (para OK)

**Rregull i propozuar (historik):** `Europe/Belgrade` (Kosovë) për **dita e biznesit** kudo — PC SQLite + cloud cron/AI.

### Shembull 00:30 Kosovë (tani: shitje restorant)

| Burim | Çfarë ndodh sot (pa fix) |
|-------|---------------------------|
| `daily_log.date` | **Lokale OS/SQLite** (`date('now','localtime')`) → **11.10** |
| `getReports` / COGS default `today` | **`toISOString()` UTC** → **10.10** deri ~02:00 |
| `owner-report-sync` `todayIso()` | **UTC** → snapshot cloud për **10.10** ndërsa shitja është **11.10** |
| Raport AI mëngjes 08:00 | **`getZonedParts` Belgrade** → «dje» = **10.10** (korrekt kalendarik) |
| Admin «Sot» (ditari pa datë) | `ditariDateRange("sot")` → **`to` UTC** → gabim 00:00–02:00 |

### Lokale (OK ose SQLite `localtime`)

- `database.js` `localTodayYmd()`, `addDailyLogEntry`, shumica `db-engine` `created_at`.
- `receipt-text.js` `RECEIPT_TIMEZONE = Europe/Belgrade`.
- Cloud: `aiDailyReportService.js` `REPORT_TZ`, cron `aiDailyReports.js`; `morningOwnerAiReportService` «dje» nga `getZonedParts` + `addDays(date,-1)`.
- Teste disa: `hotel-b2b-kontabilist.test.js` përdor `date('now','localtime')`.

### UTC / `toISOString().slice(0,10)` (duhet harmonizuar — **pas OK**)

| Modul | Skedarë kryesorë |
|-------|------------------|
| **Owner snapshot sync** | `owner-report-sync.js` (`todayIso`, `queueOwnerReportToday`, `includeToday`); `owner-report-snapshot.js` default date; `server.js` checkout ~4086–4087 |
| **Raporte / kontabilitet** | `database.js` `getReports`, `getKontabilistiBilanc`, `computeCogsForPeriod`, `ditariDateRange("sot"/"java")`, shumë `today` fallback |
| **Admin UI** | `public/admin.html` filtra, blerje, TVSH, fatura (shumë `toISOString`) |
| **Cloud pronari** | `hotelPcSnapshotAi.js`, `owner.js` routes, `salesService.js`, `ownerDailyReportService.js`, `morningOwnerAiReportService.addDays` (ISO), panel `public/js/owner.js` |
| **Të tjera PC** | `server.js` (shumë endpoint), `cloud-sync.js`, `license.js` emergency yesterday, `promotion-service.js`, fiskal Z, `reservation-sync.js`, `stock-breakage-loss.js` list/summary (regjistrim expense u lokale) |

### Çfarë ndryshohet (propozim — **jo bërë**)

1. **`lib/hotel-business-date.js`** (desktop + kopje/alias server): `businessYmd()`, `businessYesterdayYmd()`, `addBusinessDays()` me `Intl` + `Europe/Belgrade`.
2. Zëvendëso **default «sot»** në raporte, bilanc, COGS, owner sync, queue snapshot.
3. **`ditariDateRange`**: «Sot» / «Kjo javë» nga business TZ, jo UTC.
4. Cloud: `addDays` në morning AI të përdorë kalendar Belgrade (jo `toISOString` pas `Date` lokale).
5. Admin HTML: helper i njëjtë për default input datash.

### Audit HTTP (vetëm skripti — **u bë**)

`tmp-hotel-accounting-real-path-audit.js`: `businessLocalYmd` (Belgrade), `persons`, `from_date`/`to_date` ditari, rifetch ditari pas recepsionit.

**Verifikim:** `node tmp-hotel-accounting-real-path-audit.js` → **15/16 PO** (vetëm backdate = s’ekziston); `day: 2026-10-11`; `%TEMP%\hotel-real-audit-last.json`. **Programi: pa ndryshime.**

---

## 2026-10-11 — PIN legacy kamarier (6) + admin emër/rol + cloud sync + teste

**Projekt:** vetëm `hotel-system/desktop`. **Jo** build, **jo** KAFENE/RESTAURANT.

| Çfarë | Ndryshim |
|-------|----------|
| **Politika PIN** | `lib/staffPinPolicy.js`: `validateStaffPinChange` — PIN i pandryshuar pranon legacy 6 për kamarier; PIN i ri/ndryshuar → 4 (restorant) / 6 (recepsion). |
| **DB** | `updateStaffPin` përdor `validateStaffPinChange`; `updateStaffProfile(name, staff_role)` pa prekur PIN; `replaceStaffFromMaster` pranon PIN 4\|6. |
| **API** | `PUT /api/staff/:id` profil; `POST /api/staff` validon me `validateNewStaffPin` (jo vetëm 6 shifra). |
| **Admin** | Modal staf: emër + roli + «Ruaj emrin / rolin» (PIN mbetet i vjetër). |
| **Cloud sync** | `cloud-sync.js` `pushStaffAsync` / catalog: numëron staf me PIN **4 ose 6** (`isStaffPinSyncable`). |
| **Seed audit** | `tmp-hotel-real-path-seed.js`, `hotel-b2b-kontabilist.test.js` → kamarier **4321**. |
| **Thyerje stoku** | `stock-breakage-loss.js` + test: datë lokale (UTC vs `localtime` SQLite). |

**Verifikim**

- `node tests/run-all.js` → **10/10** suite.
- `node tmp-hotel-accounting-real-path-audit.js` → pas fix skripti datë/persons: **15/16 PO** (shih seksionin UTC/lokale më sipër).
- Supabase `revolution-hotel`: fshirë `ecf9a127-64c8-4ecd-8945-5bb8b106b721` → **0** rreshta me atë ID.

**Në app:** instalim/Setup i ri → mbyll programin plotësisht → hape → Admin → staf me PIN 6 legacy → ndrysho vetëm emrin/rolin → ruaj; sync cloud staf me PIN 4 ose 6.

---

## 2026-10-11 — Kontrolli i fundit para Setup (vetëm prova, pa ndryshime kod)

**Metodë:** skripte ≤5 min (nisja e serverit audit **nuk** llogaritet); printerët off; **jo** build; **jo** Electron/Setup UI 3× (nuk ekzekutuar në këtë sesion). Burim i së vërtetës: output komandash + lexim `login.html` / API.

### Tabela pritej → doli

| Zona | Pritej | Doli | PO/JO | Shënim |
|------|--------|------|-------|--------|
| **Hyrje — zona ruhet pas daljes** | `localStorage` `hotel_pc_login_pin_zone` mbetet | Kodi: `persistLoginZone()` + load rresht ~820–824 `login.html` | **PO (kod)** / **JO (UI 3×)** | Pa provë manuale logout→rihapje në app të instaluar |
| **«Ndërro»** | Buton `#login-zone-switch`, fshehur kur `loginZoneLocked` | Kodi ~852–874 | **PO (kod)** / **JO (UI 3×)** | |
| **PIN restorant 4 / recepsion 6** | `pinSubmitLengths`, `staffPinPolicy` | `protected-functions.test.js` ×3: **13/13** (përf. test PIN) | **PO** | DB/API, jo UI |
| **Legacy PIN 6 kamarier** | `[4,6]` submit + `001234` | I njëjti test ×3 | **PO** | |
| **Mesazh zonë e gabuar** | `wrong_zone` + tekst «Ndërro» | `staffPinPolicy.wrongZoneMessage`; server `wrong_zone: true` ~2711; test PIN | **PO (logjikë)** / **JO (HTTP live 3×)** | `test-login-pin-zone.js` SKIP pa `TEST_*_PIN` |
| **Kusuri recepsion 50+100→150** | `expected_closing_cash` 150.00 € | Test «recepsion shift…» ×3 runs: **15000 cent** | **PO** | `protected-functions.test.js` |
| **2 PC — «në dhomë» → folio Kryesore 1×** | import idempotent | `test-dual-pc-room-charge.js` ×3 | **PO** | |
| **2 PC — dhomë pa mysafir** | refuzo | Fazat `secondary-reject` + `master-reject` ×3 | **PO** | |
| **2 PC — relay pa LAN** | cloud queue | Skript simulon import relay (jo LAN off live 3×) | **PO (logjikë)** / **JO (2 PC fizik)** | |
| **Faqe publike te-naseri-2 — 3 tab** | Rezervim / Dhoma / Menu (+ shërbime) | HTML live: `Rezervim`, `Dhoma`, `Menu`, `data-tab` **PO**; API `sections` bosh | **PO (faqe)** | `git_commit` health **b9eda37** |
| **Rezervim web DRY → recepsion → përgjigje → fshi** | flow i plotë | `PUBLIC_BOOKING_DRY_EMAIL=1` `test-public-booking-flow.js te-naseri-2`: create **201**, list recepsion **PO**, respond **PO** (dry email) | **Pjesërisht** | **Fshirja auto JO** — mungon `PUBLIC_BOOKING_TEST_DELETE=1` + `PUBLIC_BOOKING_TEST_LICENSE_KEY`; ID test: `ecf9a127-64c8-4ecd-8945-5bb8b106b721` (fshi manual në recepsion/cloud) |
| **Rrjedha e plotë audit (restorant/recepsion/B2B/raporte)** | `tmp-hotel-accounting-real-path-audit.js` | **Dështoi seed:** PIN 6 në `tmp-hotel-real-path-seed.js` vs policy 4 shifra | **JO** | E njëjta shkak si suite B2B |
| **Të gjitha testet desktop** | `tests/run-all.js` | **9/10** suite | **JO** | Dështoi vetëm `hotel-b2b-kontabilist.test.js` (setup `addStaff` PIN 6) |
| **Të gjitha testet server** | 6× `tests/*.test.js` | **6/6 PO** | **PO** | |
| **protected + dual-pc ×3** | | **3/3 + 3/3 PO** | **PO** | ~91s + ~54s |

### Gabime sipas rëndësisë (pa fix në këtë hap)

1. **Mesatar — suite audit / B2B:** `hotel-b2b-kontabilist.test.js` dhe `tmp-hotel-accounting-real-path-audit.js` përdorin PIN 6-shifror në `addStaff` kamarier → `validateNewStaffPin` refuzon (politika 4 shifra). **Duhet përditësuar seed/test** (jo bërë tani).
2. **Mesatar — rezervim test live:** kërkesa test **nuk u fshi** automatikisht (mungon license key në env provë).
3. **I ulët — hyrje UI:** localStorage / «Ndërro» / logout **pa 3× klik** në Electron (Setup i ri duhet provuar nga Naseri).
4. **I ulët — 2 PC fizik:** relay me LAN të fikur **pa** dy PC + Wi‑Fi off (mbetet simulim skripti).

### Skedarë desktop të ndryshuar / pa commit (`hotel-system`, `git status`)

**Modified (M):** `.cursorrules`, `CLAUDE.md`, `close-table-print.js`, `cloud-auto-sync.js`, `cloud-server-url.js`, `cloud-sync.js`, `database.js`, `db-engine.js`, `fiscal/fiscal-correction.js`, `fiscal/fiscal-print.js`, `hotel-cloud-sync.js`, `hotel-qr-service.js`, `license.js`, `local-staff-links.js`, `locales/fr-map.js`, `main.js`, `online-orders-watcher.js`, `package.json`, `public/admin.html`, `public/css/login-modern.css`, `public/css/login-staff-wifi.css`, `public/js/cloud-status.js`, `public/js/hotel-inv-lines-shared.js`, `public/js/sales-invoices-ui.js`, `public/login.html`, `public/recepcion.html`, `public/waiter.html`, `sales-invoices-routes.js`, `sales-invoices-service.js`, `server.js`, `shift-close-email.js`, `shift-report-html.js`, `terminal-sync.js`, `tests/protected-functions.test.js`, `tests/run-all.js`, `waiter-shift-html.js`.

**Untracked (??) — desktop:** `PUNA.md`, `ingredient-stock-count.js`, `ingredients-recipes.js`, `lib/`, `owner-report-analytics.js`, `owner-report-snapshot.js`, `owner-report-sync.js`, `public/js/hotel-ingredients-recipes-admin.js`, `public/stock-loss.html`, `scripts/test-dual-pc-room-charge.js`, `scripts/test-login-pin-zone.js`, `stock-breakage-loss.js`, `tests/hotel-b2b-payments.test.js`, `tests/ingredients-recipes.test.js`, `tests/ingredients-stock-count-b.test.js`, `tests/owner-report-analytics.test.js`, `tests/stock-breakage-loss.test.js`, skedarë `tmp-hotel-*` (audit/e2e/prove), `tmp-role-split-*`, etj.

*(Git repo duket i grumbulluar në `hotel-system/` me path `desktop/…`; lista mbi është nga `git status` në atë rrënjë.)*

---

## 2026-10-10 — 2 PC (Recepsion Kryesore + Restorant Arka 2): faturë dhome, relay, cloud vetëm Kryesorja

**Modeli:** Recepsioni = **Arka 1 (Kryesorja)** · Restoranti = **Arka 2**. Burimi PMS / folio / cloud push = **vetëm Kryesorja**.

### Çfarë u implementua (desktop)

| Pjesë | Skedar | Përmbledhje |
|-------|--------|-------------|
| Migrim DB | `db-engine.js` | `room_charges.source_device_id`, `source_ref` + indeks unik (idempotencë import Arka 2) |
| Outbox + import | `database.js` | `lan_outbox` kind **`room_charge`**; `enqueueRoomChargeToMaster`, `importRoomChargesFromTerminal`; cache **`/api/terminal/occupied-rooms`**; paralajmërim check-out `getCheckoutPendingRoomChargeWarning` |
| API Kryesore | `server.js` | `GET /api/terminal/occupied-rooms`; `POST /api/terminal/report` pranon **`room_charges`**; relay tick import **`room_charge`**; Arka 2 **`charge-to-room`** → outbox (jo `room_charges` lokale); check-out **409** `PENDING_ROOM_CHARGES_FROM_TERMINAL`; push PMS cloud **vetëm arka1** |
| LAN sync | `terminal-sync.js` | Flush outbox: shitje + ndërrime + **faturë dhome** (LAN + cloud relay); pull dhoma të zëna; presence `pending_room_charges` |
| Cloud auto | `hotel-cloud-sync.js`, `cloud-auto-sync.js`, `owner-report-sync.js` | **`fullHotelSync` / owner report** skip në Arka 2+ |
| Prova | `scripts/test-dual-pc-room-charge.js` | Dy DB, LAN import + relay simuluar, folio 10+10 €, paralajmërim check-out |

### Cloud (`revolution-hotel-server`)

- Router **`/api/v1/terminal`** (ekzistonte në kod; deploy me mount).
- Relay kind **`room_charge`**: migrim **`093_terminal_relay_room_charge.sql`** (Supabase aplikuar), `terminalRelayQueueService.js`.

### Si ta provosh (pa build)

1. Instalo / restart **Setup** në të dy PC-të pas përditësimit.
2. Pairing: Recepsion **arka1**, Restorant **arka2** (`max_registers ≥ 2`).
3. Restorant: porosi **«në dhomë»** → menjëherë te folio Recepsioni (LAN; pa LAN → relay cloud pas migrimit 079).
4. `node scripts/test-dual-pc-room-charge.js` + `node tests/protected-functions.test.js`.

| **Arka 2 charge-to-room** | `assertChargeToRoomAgainstMasterOccupiedList` — vetëm cache **`occupied-rooms`**; lista bosh → refuzo; dhomë jo e zënë te Kryesorja → refuzo; `/api/waiter/rooms` Arka 2 **[]** pa cache (jo DB lokale). |
| **Kryesorja import** | `importRoomChargesFromTerminal` refuzon dhomë/mysafir mungon → `rejected` te LAN/relay (Arka 2 sheh `last_error` në outbox). |

**Verifikim (2026-10-10):** `protected-functions.test.js` **13/13 PO**; `test-dual-pc-room-charge.js` **PO** (+ refuzim dhomë jo e zënë / listë bosh / master reject). Supabase **093** → `room_charge` në CHECK. Live **a429039**, relay/pull **403** jo 404.

---

## 2026-10-10 — Raport leximi: 2 PC (Restorant + Recepsion), multi-arka

**Detyrë:** vetëm lexim kod — **pa ndryshime funksionale.** Skema e dëshiruar nga pronari: **Terminal 1 = vetëm Restoranti**, **Terminal 2 = vetëm Recepsioni**; të njëjtat të dhëna (dhoma, mysafirë, faturë dhome, stok, raporte); secili me **arkën** dhe **printerin** e vet.

### Si punon sot (fakt nga kodi)

| Pyetje | Përgjigje (PO/JO + burim) |
|--------|---------------------------|
| **A ka PC kryesore + terminale në LAN?** | **PO** — modeli **Kryesore (Arka 1)** + **Arka 2+**. Skedarët: `terminal-sync.js`, `terminal-relay.js`, `server.js` (`/api/terminal/*`, `lan_outbox`). |
| **Apo secila PC ka vetëm DB të vet?** | **Secila ka SQLite lokale** (`CLAUDE.md` § burimi i së vërtetës). Arka 2+ **nuk** lexon DB-në e Kryesores direkt; merr **staf / menu / stok / shërbime** nga Kryesorja (**LAN** `GET /api/terminal/staff|menu|stock|services`) ose **cloud snapshot** kur LAN dështon. |
| **Ku është «burimi i së vërtetës» për hotel PMS?** | **Kryesorja** për ndryshime strukturore (dhoma, menu, stok, staf…) — `MASTER_ONLY_WRITE_PATHS` në `server.js` (~1999): Arka 2+ merr **403** për shumicën e POST/PUT (përjashtime: p.sh. **check-in/check-out** në `/api/rooms/...` dhe `/api/admin/rooms/...`). **Të dyja** arkët mund të ekzekutojnë `hotel-cloud-sync.js` → `fullHotelSync` (push/pull dhoma, mysafirë, **charges**, hk, rezervime) drejt **cloud** (~çdo 2 min në `cloud-auto-sync.js`) — **jo** replikim i plotë hotel-PMS vetëm përmes LAN relay. |
| **Shitjet restorant nga Arka 2** | **PO** — `lan_outbox` (vetëm kur `register_number >= 2`, `setLanOutboxEnabled`) → **LAN** `POST /api/terminal/report` te Kryesorja, ose **cloud** `terminal-relay.pushQueueItems` → Kryesorja `pullQueue` + `importSalesFromTerminal` → `daily_log` + `cash_registers` remote. |

**Roli pas pairing:** `license.js` → `.terminal-module` (`kamarier` \| `recepsion`), `.terminal-role` (`arka1`, `arka2`, …). Admin (vetëm Kryesore): kod **HTL-XXXX** → `POST /api/admin/generate-pair-code` → cloud `terminalPairService` (`terminal_role` në kod).

### `terminal-relay.js` — çfarë bën

- **Qëllim:** Kur **Wi‑Fi/LAN nuk lidh** dy PC-të, **Arka 2+** dërgon **shitje + ndërrime** (payload të **sealed** me HKDF nga çelësi i licencës) te **`revolution-hotel-server`**: `POST/GET /api/v1/terminal/relay/push|pull|ack|presence|snapshots`.
- **Kryesorja** periodikisht (`masterCloudRelayTick` në `server.js`) tërheq radhën, importon në SQLite, publikon snapshot (staf, menu, stok…) për Arka 2+.
- **KAFENE** (`RESTAURANT/.../KAFENE/terminal-relay.js`): koment i njëjtë — LAN + cloud fallback (vetëm lexim, pa prekur kod).

### Pse `/api/v1/terminal/relay/pull` → **404**

- Rruga **ekziston** në `revolution-hotel-server/src/routes/terminal.js` (`router.get("/relay/pull", …)`).
- **`src/server.js` nuk monton** router-in: **nuk ka** `app.use("/api/v1/terminal", …)` (grep **JO** match).
- **Po** — kjo është shtresa për **Arka 2+ ↔ Kryesore** kur LAN mungon; pa mount, relay cloud **nuk punon** në deploy aktual (404), edhe pse desktop e thërret (`terminal-relay.js` rresht ~138).

**Shënim server:** shih `revolution-hotel-server/PUNA.md` (i njëjti datë) — vetëm dokumentim.

**Rrezik shtesë (lexim):** `terminalPairService.js` importon `getMaxRegisters` nga `licenseTerminalService.js`, por moduli eksporton **`getMaxTerminals`** — pairing/listë terminalesh në cloud mund të dështojë në runtime kur thirret (TypeError), derisa të harmonizohet emri.

### Licenca — 2 pajisje (`device_id`)

| Koncept | Ku |
|---------|-----|
| **Limit arka/terminal** | Desktop: `settings.max_registers` (1–10), nga heartbeat licencë (`license.js` → `syncMaxRegistersToSettings`). Cloud: `clients.max_registers` / `licenses.max_terminals`, tabela **`license_terminals`** (çdo `device_id` i regjistruar). |
| **Pairing** | `generatePairCode`: refuzon nëse `active.length >= maxRegisters` → `DEVICE_LIMIT_REACHED`. |
| **2 PC për të njëjtin hotel** | **PO në dizajn** — duhet **`max_registers` ≥ 2** (panel Revolution / klienti). Secili PC: **`device_id`** unik (MAC-style, `license.getMachineId()`). **Jo** «2 device_id në një licencë pa terminal të dytë të regjistruar» — terminali i dytë **join** me kod HTL. |

### Kyçja e zonës («Ky terminal: vetëm Restoranti»)

| | |
|--|--|
| **PO (me pairing)** | Pas join, ruhet `terminal_module` → `readTerminalModule` → `GET /api/login/terminal-role` kthen `terminal_module` + `lock_role_from_terminal` kur `max_registers >= 2` (`server.js` ~2457, `login.html` ~877). Login: zona **e kyçur**, pa «Ndërro» (fshihet `#login-zone-pick`). |
| **Roli në cloud** | `license_terminals.terminal_role` = `kamarier` \| `recepsion` (`terminalPairService.js`). |
| **JO** | Kyçja **nuk** varet vetëm nga `localStorage` `hotel_pc_login_pin_zone` — ajo është për PC **të vetme** multi-zonë; terminal i lidhur përdor **pairing**. |

### Printer + arkë fiskale për terminal

| | |
|--|--|
| **Arkë (cash register)** | **PO lokalisht** — `alignCashRegisterWithTerminalRole`: Arka 1 «Kryesore», Arka 2+ «Arka N» (`database.js`). Shitjet remote shfaqen te Kryesorja si **`cash_registers.remote_device_id`**. |
| **Printer** | **PO per PC** — `settings`: `printer_name`, `kitchen_printer_name`, `fiscal_printer_name` (`printer.js`) në **SQLite të atij instalimi**. |
| **Fiskal ATK/SEF** | **PO per PC** — `fiscal_settings` lokale (`fiscal-config.js`). Nuk ka sinkronizim automatik «një arkë fiskale cloud» — çdo terminal konfiguron **printerin/fiskal-in e vet** në admin të atij PC. |

### «Në dhomë» nga Restoranti — a e sheh Recepsioni **menjëherë**?

| Skenar | Sjellje |
|--------|---------|
| **Të dyja në të njëjtin PC (Kryesore)** | **PO (lokal)** — `closeTable(..., "room")` + `addRoomChargesFromOrderItems` → `room_charges` në ** të njëjtin SQLite** → recepsion e sheh në folio pa vonesë. |
| **Restorant = Arka 2+, Recepsion = Kryesore (2 PC)** | **JO menjëherë** për `room_charges`: relay LAN/cloud sync **`daily_log` shitje** (`payment_method: room` në outbox), **jo** tabelën `room_charges`. PMS **charges** shkojnë te cloud me `hotel-cloud-sync` (`pushChargesToCloud`) — interval **~2 min**, pastaj pull te PC tjetër. Recepsioni sheh **me vonesë** (cloud sync), jo realtime LAN për folio. |
| **Raportet** | Kryesorja mbledh shitje remote në `daily_log`; raporti pronarit / ditari duhet lexuar me kujdes për **dy DB** + cloud. |

### KAFENE / MARKET (vetëm lexim — multi-arka)

| Produkti | Vërejtje |
|----------|----------|
| **MARKET** | `terminal-relay.js`, `max_registers`, `getMaxRegisters()` në `database.js`, admin terminale — **model i ngjashëm** (Kryesore + arka shtesë, relay cloud). |
| **KAFENE** | `terminal-relay.js` me të njëjtin koment LAN+cloud; strukturë e ngjashme me HOTEL desktop. |
| **HOTEL specifik** | Shtresa **hotel PMS** (`hotel-cloud-sync`, `room_charges`, recepsion) — **nuk** ekziston një ekuivalente e plotë te MARKET/KAFENE. |

### Lista: çka punon / çka mungon / rruga më e sigurt

**Punon (sot, në kod):**

- Pairing HTL + rol `kamarier` / `recepsion` + kyçje zone login për Arka 2+.
- LAN: `/api/terminal/ping|staff|menu|stock|services|report` nga Kryesorja.
- Outbox shitje/ndërrime Arka 2+ → Kryesore (LAN).
- Cloud PMS sync (dhoma/mysafirë/charges) për **të dy** PC-të kur cloud online.
- Printer/fiscal/arkë **per terminal** (settings lokale).
- Admin Kryesore: lista terminale, generate pair code (përmes proxy cloud).

**Mungon / e dobët:**

- **`/api/v1/terminal/*` i pamontuar** në `revolution-hotel-server/src/server.js` → relay + pair code **404** në Railway derisa montohet router-i.
- **`getMaxRegisters` vs `getMaxTerminals`** në cloud pairing (bug i mundshëm).
- **Hotel PMS i përbashkët realtime** midis 2 PC-ve **vetëm LAN** — **jo**; charges/folio jo instant cross-PC.
- **Arka 2+** nuk merr pull **dhoma/mysafirë** nga `/api/terminal/*` (vetëm menu/stok/staf) — PMS mbështetet te **cloud sync** ose operim në Kryesore.
- **«Në dhomë» nga Arka 2** nuk replikon automatikisht `room_charges` te Kryesorja përmes relay (vetëm daily_log shitje).

**Rruga më e sigurt (propozim operacional, pa kod):**

1. **Recepsioni = Kryesore (Arka 1)** — burimi PMS (dhoma, check-in, folio, raporte hoteli).
2. **Restoranti = Arka 2** — pairing me rol **kamarier**; LAN i stabilizuar (e njëjta subnet / firewall për portin lokal ~3001).
3. **`max_registers = 2`** (ose më shumë) në licencë + **deploy cloud** me `terminal` router i montuar → relay backup kur LAN bie.
4. **Mos supozoni folio instant** për «në dhomë» nga Arka 2 — planifikoni **cloud sync ~2 min** ose (projekt i ardhshëm) relay për `room_charges` / API folio realtime.
5. **Printer/fiskal** — konfiguro **veçmas** në çdo PC; test mbyllje tavoline + print në Restorant, check-out + fiskal në Recepsion.

**Verifikim i këtij raporti:** lexim `server.js`, `terminal-relay.js`, `terminal-sync.js`, `database.js` (lan_outbox, importRemote), `login.html`, `revolution-hotel-server/src/routes/terminal.js`, `src/server.js` (pa mount). **Jo** build, **jo** ndryshim kod.

---

## 2026-10-10 — Hyrje PC (`login.html`): zona majtas, PIN 4/6

### Si ishte (para ndryshimit)

| Pjesë | Skedar | Sjellje |
|-------|--------|---------|
| Layout | `public/login.html` | **Majtas:** pronari + RFID + **Kod emergjence**. **Djathtas:** «Porosi të reja», **2 butona** Restoranti/Recepsioni, PIN 6 pika + numpad + emergjence staf. |
| Zona | JS `selectedPinLoginMode` | Klik buton → `kamarier` \| `recepsion`; **pa** `localStorage`. |
| PIN PC | `server.js` `/api/login/pin` | Vetëm `/^\d{6}$/`; mismatch → «Ky PIN nuk lejohet për këtë panel». |
| PIN DB | `database.js` `validatePin` / `findStaffByPin` | Krijim 6 shifra; `migrateStaffPinFourToSixOnce()` 4→6 me `00` prefix. |
| Admin | `admin.html` forma staf | PIN **6** për të gjithë. |
| Cloud | `revolution-hotel-server` `staffPin.js`, bootstrap | `pin_digits: 6` kudo; login pranon 4\|6. |

**Staf restorant me PIN 6-shifror (legacy):** `database.countLegacySixDigitRestaurantPins()` — numëron **rol kamarier** + PIN `/^\d{6}$/` në DB e **këtij PC**. **Nuk ndryshohen** PIN-et ekzistuese pa **OK** të Naserit.

### Ndryshim

| Skedar | Çfarë |
|--------|--------|
| `public/login.html` + CSS | Zona **poshtë Kod emergjence** (majtas): vetëm zona aktive + **Ndërro**; ruajtje `localStorage` `hotel_pc_login_pin_zone`. Djathtas: titull **Restoranti/Recepsioni**, vetëm PIN/RFID. |
| `server.js`, `lib/staffPinPolicy.js` | Restorant: PIN **4** (pranon **6** legacy); recepsion **6**; mesazh «Ky PIN është për Recepsionin/Restorantin — kliko Ndërro». |
| `database.js` | `validatePin(role)` 4/6; `findStaffByPin` 4\|6; `countLegacySixDigitRestaurantPins()`. |
| `public/admin.html` | Label/validim PIN sipas rolit (4 kamarier, 6 recepsion). |
| `package.json` `build.files` | `lib/**/*` (për Setup). |
| Cloud | `src/lib/staffPinPolicy.js`, `staffPin.js`, `waiterService.js` (`pin_digits: 4` waiter), `waiterPinService.js` login portal. |

### Provë

| Komanda | Rezultati |
|---------|-----------|
| `node tests/protected-functions.test.js` | **13/13 PO** (përf. PIN 4/6) |

**Në app (Setup + restart):** zgjidh Recepsioni majtas → dil → rihyr (mbetet) → PIN 6; **Ndërro** → Restorant → PIN 4 (ose 6 legacy).

---

## 2026-10-10 — Kërkesa rezervimi nga faqja publike (proxy PC)

**Cloud:** `revolution-hotel-server/PUNA.md` → faqe publike 3 tab-e.

| Skedar | Ndryshim |
|--------|----------|
| `hotel-cloud-sync.js` | `listPublicBookingRequestsPending`, `respondPublicBookingRequest`, `deletePublicBookingRequest` |
| `server.js` | `GET/POST /api/waiter/public-booking-requests/...` (recepsion → cloud me licencë) |

**Setup i ri** + cloud i deployuar → recepsion PC mund të lexojë/përgjigjet kërkesat (UI recepsion.html ende pa tab dedikuar — recepsion **telefon** cloud ka tab «Rezervime web»).

---

## 2026-10-10 — Ndërrim recepsion: kusuri (si kamarieri)

### Para ndryshimit (lexim kod)

| Modul | Si funksiononte |
|-------|------------------|
| **Recepsion** `recepcion.html` ~2445–2492 | Pas login, `ensureRecepShiftOpen()` bënte **automatik** `POST /api/waiter/shift/open` me **`opening_cash: 0`** — pa dritare, pa keypad. |
| **Handover recepsion** | Vetëm mesazh tekst në `recep-rooms-msg` («pranoni dorëzimin») — **jo** modal si kamarieri. |
| **Mbyllje recepsion** | Modal `modal-rc-shift-end` ekzistonte: `opening_cash`, `expected_closing_cash` (= kusur + cash), keypad numërimi — **OK**. |
| **Kamarier** `waiter.html` ~1378–1518, ~3834–3914 | `modal-shift-open`: «Sa para ke në kuletë…», keypad + preset, `shiftOpenPad` → `opening_cash`. `modal-shift-accept`: shuma e dorëzuar + keypad → `POST /api/waiter/shift/accept-handover`. `kontrolloNderrimin()` shfaq modalet kur `needs_opening_cash` / `needs_handover_acceptance`. Mbyllje: `expected = opening_cash + cash_total`. |

### Ndryshim

| Skedar | Çfarë |
|--------|--------|
| `public/recepcion.html` | Modale **`modal-rc-shift-open`** (Paratë e nisjes / kusuri) dhe **`modal-rc-shift-accept`** (pranim nga kolegu); `ensureRecepShiftOpen()` = logjikë si `kontrolloNderrimin()` — **hequr** hapja auto me 0 €. |
| `tests/protected-functions.test.js` | Test: hap **50 €** → check-out **100 €** cash → `expected_closing_cash` **150 €** → mbyllje. |

### Provë

| Komanda | Rezultati |
|---------|-----------|
| `node tests/protected-functions.test.js` | **12/12 PO** (përfsh. «recepsion shift: opening 50 + checkout 100…») |
| `node tests/run-all.js` | **10/10 PO** |

**Në app:** restart Electron / Setup i ri → recepsion: dritare kusuri para punës; mbyllja mbetet barazimi kusur + cash.

---

## 2026-10-10 — Provë recepsion 3× (1 server test, pa ndryshime programi)

**Metodë:** `node tmp-hotel-recepsion-prove-run.js` — seed `%TEMP%` → server **3944** (`HOTEL_AUDIT_DISABLE_PRINT=1`, printerët off) → `tmp-hotel-recepsion-prove-3x.js` (ndërrim 1×, pastaj 3 rrjedha) → **SIGTERM** server. **Jo** port **3001** / app i instaluar. **Jo** build.

| | Vlerë |
|---|-----|
| Nisja server | **~1 s** (≤3 min lejohet) |
| Koha e 3 rrjedhave | **~16 s** total (pas nisjes) |
| DB test | `%TEMP%\hotel-recep-prove-1791662676261.db` |
| Dalje JSON | `%TEMP%\hotel-recepsion-prove-3x.json` |
| Fatura/stay | **45,00 €** (30 €/natë + RealPath Sauna **15 €**) |
| Arka recepsion (cash) pas run | 45 → 90 → **135 €** |

**Shënim skripti (jo program):** herët dështoi `POST /api/waiter/room-reservations` **400** sepse prove dërgoi `adults: 1`; API/recepcion.html kërkon **`persons`** (`database.js` `createRoomReservation`).

### Tabela 3 prova — Pritje → Doli → PO/JO

| Run | Hapi | Pritje | Doli | PO/JO |
|-----|------|--------|------|-------|
| **1** | Rezervim | HTTP **201** | **201** | **PO** |
| | Check-in | **200** | **200** | **PO** |
| | Shërbim në dhomë | **201** | **201** | **PO** |
| | Check-out + fatura | **200**, total **45,00 €** | **200**, **45,00 €** (preview 45) | **PO** |
| | Arka recepsion | cash **45,00 €** | **45,00 €** | **PO** |
| **2** | (e njëjta rrjedhë) | si run 1; arka **90 €** | resv/ci/svc/co **201/200/201/200**; fatura **45**; arka **90** | **PO** |
| **3** | (e njëjta rrjedhë) | si run 1; arka **135 €** | resv/ci/svc/co **201/200/201/200**; fatura **45**; arka **135** | **PO** |

**Përfundim:** `allOk: true`, `proveExit: 0`. Server test **3944** i mbyllur pas provës.

---

## 2026-10-10 — Supabase hotel: migrim 090 njoftime (cloud)

089 dështoi sepse `notification_settings` mungonte — u shtua **090_notification_settings_bootstrap.sql** + boot `ensureNotificationSchema`. Detaje: `revolution-hotel-server/PUNA.md`.

---

## 2026-10-10 — Raport AI automatik te pronari (cloud)

**Para ndryshimit:** gjenerimi **23:59** (`jobs/aiDailyReports.js`); push **08:00** veçmas (`notificationDailyReports.js`) me mesazh **jo-AI** (total shitje + stok përbërësish); email gjatë gjenerimit; ruajtje `ai_daily_reports` → tab **Raporte AI**. Telefon = **Telegram/SMS** (tab Njoftimet), jo push native.

**Tani:** një pipeline në **08:00** (ora e klientit, `Europe/Belgrade`): raport për **dje** nga PC → `ai_daily_reports` + email + Telegram/SMS me tekstin AI. Pronari: `daily_report_enabled`, `daily_report_hour`, `notify_daily_report`. Cron: `morningOwnerAiReportService.js` + `jobs/aiDailyReports.js` (çdo :00). Pa `profit_forecast` në cron (1 thirrje AI/ditë + limit mujor). Migrim **089**.

**Provë:** `node tests/ai-daily-report-morning.test.js` **PO**; `node scripts/manual-morning-ai-report.js te-naseri-2 --dry-notify` kërkon `.env` Supabase — **JO** në këtë PC (pa keys).

**Git cloud:** `8ef72e3`.

---

## 2026-10-10 — AI pronari: burim i vetëm PC (`pc_analytics`)

**Qëllimi:** Tab-et AI / Raporte AI / Asistent / sugjerime furnizimi lexojnë **vetëm** `pos_owner_daily_summaries.payload` (rruga **a**), jo `sales_orders` / `ingredients` cloud.

### Desktop (sync)

| Skedar | Ndryshim |
|--------|----------|
| `owner-report-analytics.js` | **I ri** — `sales_by_item`, `stock_runway`, `breakage_by_item`, `purchases_by_item`, `deriveSnapshotInsights` |
| `owner-report-snapshot.js` | `pc_analytics: buildOwnerReportAnalytics(...)` në payload |
| `package.json` | `owner-report-analytics.js` në build.files |
| `tests/owner-report-analytics.test.js` | 3 artikuj → top Kafe Hot, pa shitje Zero Seller, ditë stoku |
| `server.js` | Tekst Pako 3 (kontabilist) |

**Fusha `payload.pc_analytics`:** `sales_by_item` (sasi, të ardhura, kosto, fitim bruto, %), `stock_runway` (stok + ditë me ritmin 30-ditor), `breakage_by_item`, `purchases_by_item` (+ furnitor).

### Cloud (`revolution-hotel-server` — commit + push)

| Skedar | Ndryshim |
|--------|----------|
| `src/services/hotelPcSnapshotAi.js` | **I ri** — lexon snapshot; payload për raport/chat/stok/furnizim |
| `src/lib/hotelAiPromptRules.js` | **I ri** — mos shpik numra; cito burimin |
| `aiDailyReportService.js`, `aiChatContextService.js`, `aiStockPredictService.js`, `supplySuggestionService.js`, `aiWaiterRatingService.js`, `profitForecastService.js`, `aiWeeklyReportService.js`, `aiChatService.js` | Burim **PC** |
| `public/owner/panel.html`, `owner-ai-*.js` | «Pako 3» (Premium + AI) |
| `tests/hotel-pc-snapshot-ai.test.js` | Insights nga `pc_analytics` |

### Provë

| Komanda | Rezultati |
|---------|-----------|
| `node tests/owner-report-analytics.test.js` (desktop) | **PO** |
| `node tests/hotel-pc-snapshot-ai.test.js` (server) | **PO** |
| `node tests/stock-breakage-loss.test.js` | **PO** |

**Në app:** Setup desktop i ri → sync cloud → panel pronari AI (live Railway pas deploy).

**Git cloud:** `revolution-hotel-server` commit `56cf149` (push `master`).

**Pako 3 (AI):** panel cloud + `payments.js` / `stripeLicenseCheckout.js`; desktop `admin.html`, `fr-map.js`, koment `server.js`.

---

## 2026-10-10 — Check-out 400 në audit HTTP (fix skripti)

**Shkaku:** skripti `tmp-hotel-accounting-real-path-audit.js` bënte `POST /api/waiter/rooms/:id/check-out` **pa** `POST /api/waiter/shift/open` (recepsion.html ~2482 e bën automatikisht).  
**Body 400:** `{ "gabim": "Filloni nderrimin me paratë e nisjes." }` — `database.js` ~9867 → `server.js` ~4036. **Jo bug programi.**

**Fix:** skripti — ndërrim recepsion, payload si `recepcion.html` ~2704–2716, recepsion ×3, seed në `tmp-hotel-real-path-seed.js` (subprocess). `run-all.js` +2 teste përbërësish. **`npm test` → 10/10 PO.**

---

## 2026-10-10 — AUDIT PËRFUNDIMTAR PARA SETUP-IT (vetëm provë — **pa ndryshime kodi**)

**Scope:** `hotel-system/desktop` + `revolution-hotel-server`. **Jo** build, **jo** Electron/Setup UI, **jo** KAFENE/MARKET.  
**Metodë:** `.cursorrules` + `CLAUDE.md`; DB `%TEMP%`; `HOTEL_DB_PLAIN=1`; `HOTEL_AUDIT_DISABLE_PRINT=1` / `printers.enabled=0`; port test **3995–3998**; **≤5 min/skript**.  
**Dalje:** `%TEMP%\hotel-real-audit-last.json`; `%TEMP%\hotel-final-audit-run.log`; `%TEMP%\hotel-final-e2e-audit-*`; `%TEMP%\hotel-final-http-audit-*`.

### Teste automatike (×4 desktop + ×4 server)

| Skript | Pritje | Doli | PO/JO |
|--------|--------|------|-------|
| `node tests/run-all.js` (8 suite) | 8/8 | **8/8** ×4 | **PO** |
| `node tests/ingredients-recipes.test.js` | OK | OK ×4 | **PO** |
| `node tests/ingredients-stock-count-b.test.js` | OK (−0,25 kg / −2 €) | OK ×4 | **PO** |
| `revolution-hotel-server/tests/*.test.js` (5 skedarë) | OK | OK ×4 | **PO** |
| `run-all.js` përfshin recetat/numërim | — | **2 skedarë jashtë listës** (`ingredients-*.test.js`) | **JO** (vetëm `run-all` — duhet edhe 2 teste manual) |

### HTTP rrugë reale — `tmp-hotel-accounting-real-path-audit.js` (×3, ~14 s/run)

| Pika | Pritje | Doli (×3 i njëjti) | PO/JO | Skedar |
|------|--------|-------------------|-------|--------|
| PIN kamarier | token | OK | **PO** | `server.js` `/api/login/pin` |
| Blerje API → stok +100 | 100 | 100 | **PO** | `POST /api/purchases` |
| TVSH blerje (bruto 100 → neto 84,75 + TVSH 15,25) | barazim | barazim | **PO** | `kontabilisti-atk.js` |
| Mbyllje tavoline cash / room / mixed | 3×200; cash 30 €, room 20 € | 3×200; 30 / 20 | **PO** | `POST /api/orders/close` |
| Stoku −3 | 97 | 97 | **PO** | `decrementMenuItemStock` |
| Ndërrim restorant (arka = hapje + cash) | 50 | 50 | **PO** | `computeShiftTotals` |
| COGS = sasi × kosto mesatare | 3 | 3 | **PO** | `computeCogsForPeriod` |
| Reconcile stok | expected=actual | PO | **PO** | `reconcileStock` |
| Snapshot pronari = `getReports.totalSales` | cent | 50=50 | **PO** | `owner-report-snapshot.js` |
| Ditari = `totalSales` | cent | PO | **PO** | `getDitari` / `getReports` |
| Rezervim→CI→shërbim→CO (API recepsion) | CO 200; `hotelServices`>0 | **`co=400`**, services=0 | **JO** | `server.js` ~3957–4024; skripti ~372–416 (**pa shërbim aktiv** në `runSetup` minimal) |
| Backdate room_charge / shërbim | param `date` | mungon (by design audit) | **JO** * | `database.js` `addRoomCharge`; `server.js` add-service |

\* Rreshti «backdate» është **kufizim i njohur** (audit e vjetër Mars = gabim skripti), jo regresion i ri i Setup-it.

### E2E HTTP — `tmp-hotel-e2e-audit-http.js` / `tmp-hotel-e2e-audit.js`

| Pika | Pritje | Doli | PO/JO | Shënim |
|------|--------|------|-------|--------|
| PIN kamarier / recepsion / rol i gabuar | PO | PO (kur DB e seeduar) | **PO** | `:3997` ×3 |
| PIN kamarier #2 (2 kamarierë) | token | refuzuar (1 kamarier në seed) | **JO** * | *skripti pret 2 kamarierë |
| Hyrje pronari API | token | **dështoi** nëse `prep` pas `server.js` (cache fjalëkalimi) | **JO** * | *metodë: **prep → flush → pastaj** `node server.js` |
| Restorant 4 pagesa, ndërrime, blerje, B2B, raport, TVSH | PO | **nuk u ekzekutua** (bllokim admin) | **?** | Përdor `real-path` + teste B2B |
| PIN pastrim (`login_mode=sherbimi`) | token | **PO** ×3 | **PO** | `POST /api/login/pin` |

### Fiskalizimi (lexim diff — pa ATK, pa printer)

| Pika | Pritje | Doli | PO/JO | Skedar |
|------|--------|------|-------|--------|
| `fiscal-correction.js` / `fiscal-print.js` vs git | vetëm stok + etiketë «Në dhomë» | diff: `restoreMenuItemStockFromSale` (~497–512); `normalizeSplitMethod`/`pay_room` (~552–576) | **PO** | `fiscal/fiscal-correction.js`; `fiscal/fiscal-print.js` |
| Kuponi jo dy herë (<5s dedup) | kod | `fiscal-main.js` ~374 dedup-skip | **Pjesërisht** | pa runtime printer |
| Pa dërgim ATK në provë | env | `fiscal_skip` + fiscal OFF në test | **PO** | `FISCAL_LOCAL_RUN` / `HOTEL_ATK_SEND_ALLOWED=0` |

### Zonat e mbuluara nga teste DB (jo UI) — ×4

| Zona | PO/JO | Burim |
|------|-------|--------|
| Restorant stok / raport pa dyfishim / arka room vs cash | **PO** | `protected-functions.test.js` |
| B2B faturë + pagesë 40 € + borxh 60 € | **PO** | `hotel-b2b-payments.test.js` + route `POST .../payments` (`sales-invoices-routes.js` ~73) |
| Kontabilitet TVSH / bilanc | **PO** | `kontabilisti-atk.test.js`, `hotel-b2b-kontabilist.test.js` |
| Blerje neto/bruto skanim | **PO** | `purchase-neto-bruto.test.js` |
| Thyërje → shpenzim, fitim ↓ | **PO** | `stock-breakage-loss.test.js` |
| Përbërës blerje → recetë → shitje → anulim | **PO** | `ingredients-recipes.test.js` |
| Numërim + variance | **PO** | `ingredients-stock-count-b.test.js` |
| Përmbledhje ditore / analytics | **PO** | `owner-report-analytics.test.js` |
| Cloud AI snapshot (lexim) | **PO** | `revolution-hotel-server` `hotel-pc-snapshot-ai.test.js` |
| Factory reset | **PO** | `factory-reset-wipe.test.js` |

### Zonat **pa** provë E2E të plotë në këtë sesion

| Zona | PO/JO | Arsye |
|------|-------|--------|
| Hyrje pronari në app të instaluar (cloud key) | **?** | Vetëm API me temp admin në kopje |
| RFID | **?** | Pa kartelë |
| Recepsion: CI cloud **menjëherë** + QR dhomë + venue 15 min | **?** | DB test pa `kitchen_key`; QR kërkon cloud + mysafir (shih audit recepsion 2026-10-10 në këtë skedar) |
| Kuponi termik / ESC/POS live | **?** | Printerët off (rregull provash) |
| Panel pronari cloud (UI) | **?** | Vetëm health GET **PO** (`git_commit` fe16e5f…) |

### QR skadim 15 min (lexim kod)

| Burim | Vlera |
|-------|--------|
| `online-orders-watcher.js` ~18 | `UNTOUCHED_PENDING_EXPIRE_MS = 15 * 60 * 1000` |
| `cloud-sync.js` ~22 | `QR_PENDING_PROTECT_MS = 15 min` |
| Cloud | `pendingAcceptExpiry.js` (referencë PUNA e mëparshme) |

**Runtime E2E QR:** **nuk u provua** (pa POST cloud test).

### Gabime / mangësi — sipas rëndësisë (mos u rregullua)

| # | Rëndësi | Çfarë | Skedar + rresht |
|---|---------|--------|-----------------|
| 1 | **i rëndë** | Flow recepsion i plotë në `real-path` audit: **check-out HTTP 400**, `hotelServices=0` (setup minimal / shërbime) | `tmp-hotel-accounting-real-path-audit.js` ~404–412; `server.js` ~3957 |
| 2 | **i rëndë** | **UI Electron / Setup i instaluar** — asnjë zonë e listuar nuk u klikua | — |
| 3 | **i rëndë** | **QR + cloud sync** dy-krahësh (dhomë/tavolinë/venue, 15 min) — pa `kitchen_key` në DB test | `tmp-hotel-e2e-qr-single.js` (kërkon deploy + key) |
| 4 | **mesatar** | Skriptet E2E: admin login dështon nëse server niset **para** `tmp-hotel-e2e-prep.js` | `tmp-hotel-e2e-audit.js` ~69–75; `tmp-hotel-e2e-audit-http.js` |
| 5 | **mesatar** | `run-all.js` **nuk** thërret `ingredients-recipes` / `ingredients-stock-count-b` | `tests/run-all.js` ~7–16 |
| 6 | **mesatar** | Raport recepsion i vjetër: `hotelServices` vs `reception_collected.services` (UI) | `database.js` ~8502–8524 (audit i mëparshëm) |
| 7 | **i vogël** | Backdate charges (kontabilitet historik) | `database.js` `addRoomCharge`; `server.js` add-service |
| 8 | **i vogël** | Fiskal runtime me licencë + printer fizik | `fiscal-main.js` ATK path |

**Pastrim:** vetëm DB `%TEMP%`; **asnjë** POST/DELETE cloud për këtë audit.  
**Verifikim:** `run-all` + ingredient tests + `real-path` ×3 + health cloud — **PO** për pjesën automatike; **JO/?** për UI + QR cloud + recepsion block në `real-path`.

---

## 2026-10-10 — Recetat & përbërësit: PJESA A (PC) — implementuar

**Scope:** vetëm `hotel-system/desktop`. **Pa cloud.** **Pa build.**

### Çka u ndërtua

| Skedar | Përmbajtje |
|--------|------------|
| `ingredients-recipes.js` | **I ri** — CRUD përbërës, receta (`menu_recipe_lines`), blerje → stok/kosto mesatare, zbritje/kthim shitje, kosto porcioni |
| `db-engine.js` | Migrim `hotel-ingredients-recipes-v1` (`ingredients`, `menu_recipe_lines`); `purchase_invoice_items.ingredient_id` |
| `database.js` | Blerje menu **ose** përbërës; `decrementMenuItemStock` / `restoreMenuItemStockFromSale`; `getMenuItemCostForCogs` nga receta; fshirje blerje përbërës |
| `server.js` | API `/api/ingredients`, `/api/menu/:id/recipe` |
| `public/js/hotel-ingredients-recipes-admin.js` | **I ri** — UI Stoku (përbërës), receta në edit produkt, blerje Menu/Përbërës |
| `public/admin.html` | Panel përbërësish, receta, rreshta blerje |
| `fiscal/fiscal-correction.js` | Kthim stoku (përbërës/copë) pas kuponit korrigjues |
| `tests/ingredients-recipes.test.js` | **I ri** — skenari Naseri (10 kg×8 €, Biftek 0,25 kg, 6 shitje, anulo 1, Coca-Cola) |
| `package.json` | `ingredients-recipes.js` në `build.files` (Setup i ardhshëm) |

### Verifikim

| Prova | Rezultat |
|-------|----------|
| `node tests/ingredients-recipes.test.js` | **PO** — stok 8,5 kg → 8,75; kosto porcion 2 €; COGS shitur 12 €; Coca-Cola 50→47→48 |
| Të gjitha `tests/*.test.js` (8 skedarë) | **PO** |
| Cloud / sync | **Nuk u prek** |

**Në app:** Setup i ri (ose restart nga burimi dev) → Admin → Stoku (përbërës) + Menuja (receta) + Blerjet (lloji Përbërës).

---

## 2026-10-10 — Recetat & përbërësit: PJESA B (numërim, variance, pc_analytics) — implementuar

**Scope:** `hotel-system/desktop` (+ cloud lexim në `revolution-hotel-server`, commit atje). **Pa build.**

### Çka u ndërtua (PC)

| Skedar | Përmbajtje |
|--------|------------|
| `ingredient-stock-count.js` | **I ri** — sesione numërimi, korrigjim stoku (kush/kur), `buildConsumptionVarianceReport`, `buildIngredientsSnapshot` |
| `db-engine.js` | Migrim `hotel-stock-count-v1` (`stock_count_sessions`, `stock_count_lines`) |
| `database.js` | `submitStockCount`, `listStockCountTargets`, `buildConsumptionVarianceReport`, `buildIngredientsSnapshot`; thyerje `source_type: ingredient` |
| `owner-report-analytics.js` | `pc_analytics.ingredients`, `last_stock_count`, `consumption_variance_week`; insights (minimum, humbje, numërim, fitim i dobët) |
| `server.js` | `/api/stock-count/*`, `/api/inventory/consumption-variance` |
| `public/admin.html` | UI numërim + tabelë krahasimi harxhimi |
| `public/js/hotel-ingredients-recipes-admin.js` | Ruaj/rifresko numërim, ngarko variance (sortim humbje ↑) |
| `stock-breakage-loss.js` | Thyërje për përbërës në formulën «u harxhua» |
| `package.json` | `ingredient-stock-count.js` në paketim |
| `tests/ingredients-stock-count-b.test.js` | **I ri** — vazhdon PJESËN A: 8,75 kg → numërim 8,5 → −0,25 kg / −2 € |

**Formulat:** `expected = shitje × recetë`; `actual = hapje + blerje − mbyllje (numërim) − thyerje`; `variance = actual − expected`.

### Verifikim (rregulli i provave)

| Prova | Rezultat |
|-------|----------|
| `node tests/ingredients-stock-count-b.test.js` | **PO** — diff −0,25 / −2 €; stok 8,5; snapshot + insights + variance |
| Të gjitha `tests/*.test.js` (9 skedarë, ~24 s) | **PO** (8/8 suite) |

**Në app:** Setup i ri → Admin → Stoku → «Numërim stoku» + «Krahasim harxhimi»; përmbledhja ditore / AI merr `pc_analytics` të zgjeruar pas sync.

**Git cloud:** shih `revolution-hotel-server/PUNA.md` (PJESA B cloud).

---

## 2026-10-10 — Recetat & përbërësit: gjendja, plani PC-only, pengesat (prit OK)

**Scope:** vetëm `hotel-system/desktop` + `revolution-hotel-server`. **Pa ndryshime kodi** — vetëm ky dokument. **Pa build.** **Pa prekje** KAFENE/MARKET/FURRA/BIZNES.

**Qëllimi i planit (Naseri):** përbërës + receta **vetëm në PC**; cloud **lexon**; blerje kg/l → stok përbërësi; shitje zbret recetën; numërim javor vs «duhej të harxhohej»; artikuj pa recetë = copë si sot; të dhënat në përmbledhje ditore + AI.

---

### 1) Si ruhen blerjet në PC sot

| Shtresë | Ku | Fushat |
|---------|-----|--------|
| Header | `purchase_invoices` (`db-engine.js` ~624–632) | furnitor, nr/datë fature, total, `status`, `purchase_kind` (goods vs shërbime), TVSH header |
| Rresht | `purchase_invoice_items` (~634–644) | `menu_item_id`, `product_name`, **`quantity` (REAL)**, **`unit_price`**, `line_total`, `vat_rate` |

**Nuk ka** kolonë **`unit` (kg / l / copë / pako)** në DB të faturës — njësia është **implicit** te produkti i menusë / interpretimi i UI.

| Rrugë regjistrimi | Njësia në praktikë |
|-------------------|-------------------|
| **Blerje manuale** (`createPurchaseInvoice`, `database.js` ~11228+) | Zgjidhet **artikull menu**; sasia shkon direkt te `applyPurchaseStockDelta(menu_item_id, quantity)` → **`menu_items.stock_qty`** (+qty). |
| **Skanim AI / radha cloud** (`purchase-cloud-pull.js` → `ai-receipt-scan.applyReceiptToStock`) | Rreshti skanuar ka **`unit`** + **`pieces_per_pack`**; `packMath.convertPackToPieces` e kthen në **sasi numerike** për faturë; përsëri **`createPurchaseInvoice`** → **`stock_qty`** të **menu_item** të përputhur/krijuar. |

**Çmimi:** `unit_price` = çmimi për njësinë e rreshtit pas konvertimit (p.sh. €/kg ose €/copë, varësisht si u lexua fatura).

**Kostoja COGS sot:** `getMenuItemCostForCogs` = mesatar i blerjeve për **të njëjtin `menu_item_id`**, jo për përbërës recete (`database.js` ~10920–10928).

---

### 2) A mund të blihet «10 kg mish» dhe të shitet me porcion?

| Pyetje | Përgjigje (kodi aktual) |
|--------|-------------------------|
| 10 kg si blerje | **PO vetëm si sasi 10** te një **artikull menu** (p.sh. «Mish i freskët») — stoku rritet **`stock_qty += 10`** (nëse produkti trajtohet si njësi decimale; UI skanimi mbështet kg/l/copë/pako para konvertimit). |
| Shitje «Biftek» porcion | **JO automatikisht nga 1 kg:** **Biftek** është zakonisht **tjetër `menu_item_id`**. Shitja thërret **`decrementMenuItemStock`** → zbret **stokun e Biftekit**, **jo** mishin e blerë, **pa** recetë. |
| Lidhje kg → porcione | **Mungon** shtresa përbërës/recetë në SQLite HOTEL. Për «sa porcione nga stoku» duhet model i ri (p.sh. 0,250 kg mish / porcion). |

**Përmbledhje:** blerja dhe shitja janë **të dyja në nivel artikull menu**, jo **lëndë e parë → pjatë**.

---

### 3) Cloud vs PC — çka ekziston, kush e përdor

| Artefakt | Cloud (`revolution-hotel-server`) | PC (`hotel-system/desktop`) |
|----------|-----------------------------------|-----------------------------|
| **Përbërës** | `ingredients` — emër, `unit` (kg/l/copë), `quantity`, `min_quantity`, `cost_per_unit` (`025_inventory.sql`) | **Asnjë** tabelë `ingredients` |
| **Receta** | `menu_ingredients` — `menu_item_id` (UUID `pos_menu_items`) + `ingredient_id` + `quantity_used` | **Asnjë** `menu_ingredients` / `recipe_items` |
| **Zbritje në shitje** | `inventoryService.deductIngredientsForOrder` — lexon recetën Supabase, ul **`ingredients.quantity`** | `closeTable` / `closeTablePartial` / room service → **`decrementMenuItemStock`** → **`menu_items.stock_qty`** |
| **Blerje** | `apply-invoice-scan` → **`pos_pending_purchases`** (desktop) + **opsional** rritje **`ingredients`** cloud (`inventoryService.applyInvoiceScanItems` ~327+) | **`createPurchaseInvoice`** → **`menu_items.stock_qty`** |
| **UI pronari** | `owner-inventory.js` — CRUD **`GET/POST /api/owner/ingredients`**; **pa** API/UI për **`menu_ingredients`** (receta vetëm në DB + tekst panel) | Stoku / Blerjet / reconciliacion në **admin** — **`menu_items`**, `reconcileStock()` |
| **AI / raport** | Pas **`pc_analytics`:** shitje/stok menu kryesisht nga **`pos_owner_daily_summaries`** (`hotelPcSnapshotAi.js`). **`ingredients` cloud** mbeten për: panel inventari, **`deductIngredientsForOrder`** (shitje cloud), pjesë legacy (`aiDailyReportService.estimateDailyProfit` lexon **`menu_ingredients`**) | Snapshot: `owner-report-snapshot.js` → **`pc_analytics`** (artikuj menu, **jo** përbërës/receta) |

**Kush e përdor çfarë (rrugë reale hotel me PC kryesor):**

| Rruga shitjeje | Stoku që lëviz |
|----------------|----------------|
| **POS desktop** — mbyllje tavoline, partial, shumica room service | **`menu_items.stock_qty`** |
| **Cloud** — `salesService`, `waiterService`, `kioskService`, `publicOrderService` | **`ingredients`** (nëse ka recetë në Supabase) + **`pos_menu_items`** / porosi cloud (paralel me desktop) |

**Dy burime sot:** stoku **i menusë në PC** vs **përbërësit në Supabase** — **nuk sinkronizohen** (grep sync: **pa** `ingredients`/`recipe` në desktop).

---

### 4) MARKET / FURRA (vetëm lexim — referencë)

| Produkt | Receta / përbërës? | Modeli (citim) |
|---------|-------------------|----------------|
| **MARKET** | **PO** | SQLite **`recipe_items`**: `menu_item_id` → `ingredient_menu_item_id` + `quantity_used` (`MARKET/.../database.js` ~542–549). Në shitje, `decrementMenuItemStock` lexon recetën dhe zbret **stokun e artikujve-përbërës** (`~9610–9638`). Përbërësi = **tjeter rresht `menu_items`**, jo tabelë `ingredients` e veçantë. |
| **FURRA** | **Jo gjetur** | `grep recipe|ingredient` në `FURRA/` — **pa** përputhje të qartë recete në kod (mund të jetë vetëm stok copë / menu). |

**Mësime për HOTEL (pa kopjuar kod):** MARKET e zgjidh recetën **në PC** me lidhje **menu → menu (lëndë)**; HOTEL cloud ka **menu → ingredients (UUID)** — **jo i njëjti model** me desktop-in aktual.

---

### 5) Plani i propozuar vs gjendja — çfarë mungon

| Kërkesë plani | Gjendja | Pengesë / punë |
|---------------|---------|----------------|
| Burim i vetëm **PC** | Cloud ende **shkruan/lexon** `ingredients`; skanimi **mund** të rrisë cloud **dhe** PC | Duhet **deprecate** shkrim cloud + **sync lexues** nga snapshot |
| Përbërës: emër, njësi, stok, kosto/njësi nga blerje | Vetëm **`menu_items.stock_qty`** + blerje të lidhura me **menu_item_id** | Tabela **`ingredients`** (ose ekuivalent) **SQLite** + blerje që targetojnë **përbërës**, jo vetëm artikull shitjeje |
| Receta për artikull menu | **Vetëm Supabase** `menu_ingredients` | Schema + UI + API **desktop**; map **`menu_item_id` lokal ↔ UUID** për cloud read-only |
| Porcione nga stoku / kosto porcioni | **Jo** | Llogaritje: `floor(stok / sum(receta))` + kosto = Σ(qty_recetë × cost_per_unit) |
| Shitje zbret përbërës; anulim kthen | Desktop: **copë menu**; cloud: **përbërës** | Hook në **`decrementMenuItemStock`** / anulim — si MARKET por me njësi kg/l |
| Blerje kg/l → përbërës | Blerje → **menu_item** | Rregull: blerje **goods** → përbërës (ose map produkt blerje ↔ përbërës) |
| Krahasim javor: duhej vs harxhuar (fillestar + blerje − numërim) | **`reconcileStock()`** vetëm **artikuj menu** (`database.js` ~11120–11148), formula: fillestar + blerje + manual − shitje | Duhet **i njëjti model për përbërës** + **«pritet nga shitje×recetë»** vs **numërim fizik** |
| Numërim stoku stafit | Nuk ka modul **inventarizim përbërësish**; ka reconciliacion **menu** + thyerje/humbje | UI numërim + ruajtje `stock_count_sessions` (ose settings) për përbërës |
| Pa recetë (Coca-Cola) | **`decrementMenuItemStock`** copë | Mbaj **track_stock** në artikull; mos prek recetën |
| Përmbledhje ditore + AI | **`pc_analytics`** — artikuj, **jo** përbërës/variance receta | Zgjero **`owner-report-analytics.js`** + **`hotelPcSnapshotAi.js`** |

---

### 6) Çfarë duhet ndryshuar në cloud që **mos** ketë dy burime

| Veprim | Detaje |
|--------|--------|
| **Burim i vetëm shkrimi** | Përbërës, receta, stok, numërime, variance → **SQLite PC**; cloud **nuk** `UPDATE ingredients` nga shitje/skanim (veç **mirror**). |
| **`deductIngredientsForOrder`** | Për klient **hotel + POS desktop** → **no-op** ose vetëm log; mos ul **`ingredients`** kur shitja reale është PC (ose hiq thirrjen nga `salesService` / waiter / kiosk / public kur `PRODUCT_LINE=hotel`). |
| **`apply-invoice-scan` hap 2** | Hiq ose **default off** rritjen **`ingredients`**; mbaj vetëm **`pos_pending_purchases`** → desktop. |
| **`/api/owner/ingredients`** | **Read-only** nga payload i fundit PC (si `pos_menu_items`), **ose** redirect UI te «menaxho në program desktop»; **mos** CRUD që divergon. |
| **`menu_ingredients`** | Shto **sync push** nga PC (JSON në snapshot ose tabelë `pos_recipes`); panel lexon **mirror**; **API write** vetëm nga sync desktop. |
| **AI / supply / stok kritik** | Tash **`analyzeLowStockFromPcSnapshot`** (`supplySuggestionService.js`) — vazhdo; **mos** `analyzeLowStockIngredients` cloud si burim paralel. Legacy **`menu_ingredients`** te `aiDailyReportService.estimateDailyProfit` → zëvendëso me **`pc_analytics`** kur implementohen përbërësit. |
| **Supabase** | Tabelat **`ingredients` / `menu_ingredients`** mund të mbeten si **cache leximi** (FK `pos_menu_items`), jo si inventari operativ. |

---

### 7) Propozim fazash (pas OK të Naserit — **jo** implementuar)

1. **Schema PC:** `ingredients`, `menu_recipe_lines` (ose emër i njëjtë me cloud), blerje → përbërës, `cost_per_unit` nga mesatar blerje.
2. **Shitje/anulim:** zbritje/kthim recete; artikuj pa recetë = rrugë aktuale.
3. **UI desktop:** receta, numërim, raport variance (javor).
4. **Snapshot + sync:** fusha `pc_analytics.ingredients`, `recipes`, `ingredient_variance_weekly`.
5. **Cloud:** read-only + çaktivizo shkrimet e listuara në §6.

---

### 8) Verifikim (lexim kodi)

| Skedar | Lexuar për |
|--------|------------|
| `desktop/db-engine.js`, `database.js` | blerje, stok, reconcile, COGS |
| `desktop/ai/ai-receipt-scan.js`, `purchase-cloud-pull.js` | njësi/pako → faturë |
| `server/supabase/migrations/025_inventory.sql`, `inventoryService.js` | cloud inventar |
| `server/public/js/owner-inventory.js` | UI përbërës |
| `MARKET/.../database.js` | `recipe_items` (referencë) |

**Status:** **prit OK** nga Naseri para çdo ndryshimi kodi.

---

## 2026-10-10 — Audit lexues: AI pronari + blerje/parti + receta (desktop + cloud)

**Scope:** `hotel-system/desktop` + `revolution-hotel-server`. **Pa ndryshime kodi** (vetëm ky seksion në PUNA.md). **Pa build.**

### Ku jeton UI

| Vend | Skedarët |
|------|----------|
| Panel pronari (telefon/web) | `revolution-hotel-server/public/owner/panel.html`, `public/js/owner.js` |
| JS AI | `public/js/owner-ai-modules.js`, `owner-ai-reports.js`, `owner-ai-assistant.js`, `owner-supply-suggestions.js`, `owner-invoice-scan.js`, `owner-inventory.js`, `owner-stock.js` |
| Backend AI | `src/routes/ai.js`, `src/routes/owner.js`, `src/services/ai*.js`, `profitForecastService.js`, `supplySuggestionService.js` |
| **Desktop** | **Nuk** ka `owner-ai-*.js` — AI është **vetëm cloud**; PC luan rol sync (`owner-report-sync.js`, `purchase-cloud-pull.js`). |

**Licencë AI (HOTEL):** `hotelPackageTier.js` — feature `ai` vetëm **`pako_3`** («Premium + AI»). UI pronari/cloud: **Pako 3** (raport 2026-10-10).

**Aktivizim:** `GET /api/ai/status` → `enabled = AI keys + !AI_PAUSED + pako_3`. Pa Pako 3 / pa key → tab-et AI të fshehura ose të bllokuara (`owner.js` `applyAiUiState`).

---

### Tab «AI» (`panel-ai`, `owner-ai-modules.js`)

| Pjesë | Çfarë bën | Burimi i të dhënave | Punon për HOTEL (PC kryesor)? |
|-------|-----------|---------------------|-------------------------------|
| Përdorim tokenësh | `GET /api/ai/usage` | `ai_usage_logs` | **PO** nëse ka thirrje AI |
| Buton → Blerje / skanim | Navigon te skeda Blerje | — | **PO** (UI) |
| Kamarierët + «Analizo AI» | `GET/POST /api/owner/ai-waiter-rating*` | **`sales_orders`** (refuzime, `refused_by_waiter_ids`, 30 ditë) | **Pjesërisht** — vetëm porosi **cloud/telefon/QR**, jo mbyllje tavoline në desktop |
| Stok kritik + «Analizo AI» | `GET/POST /api/owner/ai-stock-predict*` | **`ingredients`** (Supabase) + **`getOwnerReport` → `orders` (zakonisht [])** për «top shitje» | **Pjesërisht** — minimumi përbërësish **PO**; parashikimi nga shitje **JO** nëse nuk ka rreshta në `sales_orders` |
| Raporte javore | `GET /api/owner/ai-weekly-reports` | **`getOwnerReport`** (totale nga snapshot) + **`aggregateTopItems(orders)`** | **Pjesërisht** — totali **PO** me rruga **(a)**; top artikuj **shpesh bosh** |

---

### Tab «Raporte AI» (`owner-ai-reports.js`)

| Pjesë | API | Burimi | Punon? |
|-------|-----|--------|--------|
| Raport ditor + tekst AI | `GET/POST /api/owner/ai-reports*` | Gjenerimi: `buildDailyReportPayload` → **`getOwnerReport`** → **`pos_owner_daily_summaries.payload`** (rruga **a**) + stok **`pos_menu_items`** + **`ingredients`** | **PO** për shitje/fitim/stok menu **nëse PC sync-on snapshot**; **`order_count` në payload mbetet 0** (`salesService.getOwnerReport` ~929–933) |
| Cron 23:59 | `src/jobs/aiDailyReports.js` | I njëjti pipeline + ruajtje **`ai_daily_reports`** | **PO** me Pako 3 + keys + sync |
| Parashikim fitimi | `GET/POST .../profit-forecast*` | `profitForecastService.buildProfitForecast` — seri 30 ditë nga **`groupOrdersByDay(report.orders)`** | **JO / dobët** për hotel me shitje kryesisht në PC: **`orders: []`** te `getOwnerReport` → grafiku/trend shpesh **0** edhe kur snapshot ka të ardhura |
| Email raport | `emailService` | Resend i konfiguruar | **Varet** nga env |

---

### Tab «Asistent AI» (`owner-ai-assistant.js`)

| Pjesë | API | Model | Burimi konteksti (`aiChatContextService.js`) |
|-------|-----|-------|-----------------------------------------------|
| Chat | `POST /api/owner/ai-assistant/chat` | **Vetëm Anthropic** — `ANTHROPIC_MODEL` ose default **`claude-sonnet-4-6`** (`aiChatService.getOwnerChatConfig`) | **`buildDailyReportPayload`** (snapshot **a**), raporti AI i ditës, **supply_suggestions**, **waiter_ratings** (`sales_orders`), **stock_predict** (`ingredients` + orders bosh) |
| Histori | `GET/DELETE .../history` | DB chat | **PO** |
| Zë / mikrofon | Web Speech API | — | **Varet** nga shfletuesi |

**Punon:** bisedë + numra **të ardhurash/fitimi** nga snapshot **nëse sync OK**. **Jo besueshëm:** porosi, top shitje nga `sales_orders`, stok i përbërësve nëse inventari cloud nuk mbahet.

---

### `owner-supply-suggestions.js`

| Hapi | API | Burimi |
|------|-----|--------|
| Listë | `GET /api/owner/supply-suggestions` | Tabela **`supply_suggestions`** (Supabase) |
| Gjenero | `POST .../generate` | `analyzeLowStockIngredients` → **`ingredients`** (`quantity` ≤ `min_quantity`); tekst AI opsional |
| Email | `POST .../send-email` | Resend |

**Desktop stok menu (`menu_items.stock_qty`) nuk lexohet** këtu — vetëm **përbërësit cloud**. Për hotel pa `ingredients` të mbushur → **lista bosh / «në rregull»**.

---

### `owner-invoice-scan.js`

| Hapi | API | Pas skanimit |
|------|-----|--------------|
| Skanim | `POST /api/ai/scan-invoice` | **`aiInvoiceScanService`** — vision **Anthropic** (`aiVisionConfig`, default **claude-sonnet-4-6**) |
| Regjistro | `POST /api/owner/inventory/apply-invoice-scan` | **1)** `pos_pending_purchases` → desktop **`purchase-cloud-pull.js`** → `createPurchaseInvoice` lokal; **2)** opsional **`ingredients`** cloud |

**Punon** skanim + radhë POS **nëse** desktop online dhe pull punon. **Nuk** regjistron skadencë/parti (shih më poshtë).

**Skeda Stoku:** `owner-inventory.js` — CRUD **`/api/owner/ingredients`** (përbërës cloud). **Nuk** ka UI/API owner për **`menu_ingredients`** (receta).

---

### Tab «Raportet» (jo AI) vs rruga (a)

`GET /api/owner/reports` → `getOwnerReport` — **`source: "pos_daily_summaries"`** (`salesService.js` ~882–951): totalet nga **`pos_owner_daily_summaries`**, plus **`sales_orders` status `expired`** për porosi online të skaduara. **Jo** listë porosish të mbyllura POS.

---

### Blerjet — skadencë dhe parti

| Sistem | Ruhet skadenca / lot? |
|--------|------------------------|
| **Desktop** `purchase_invoices` / `purchase_invoice_items` (`db-engine.js` ~624–644) | **JO** — vetëm furnitor, datë fature, sasi, çmim, TVSH |
| **Cloud** `ingredients` (`025_inventory.sql`) | **JO** — `quantity`, `min_quantity`, `cost_per_unit` |
| **Thyerje/humbje** (desktop 2026-10-10) | Arsye `skado` si **kategori humbje**, **jo** FIFO lot |

**Mungon:** fusha `expiry_date`, `batch/lot`, lidhje blerje→lot, alarm skadimi, FIFO/FEFO.

---

### Receta (menu → përbërës)

| Ku | Gjendja |
|----|---------|
| **Cloud Supabase** | **`menu_ingredients` + `ingredients`** — zbritje në **`deductIngredientsForOrder`** kur mbyllet shitje **jo-web** në `salesService` (~524–534) |
| **Desktop SQLite** | **Asnjë** tabelë/API recete (`grep` pa përputhje); shitje → **`decrementMenuItemStock`** te **`menu_items.stock_qty`** |
| **Panel pronari** | Menaxhon **përbërës**, **jo** lidhje menu↔recetë (pa route `menu_ingredients`) |

**Për shembull «sallata»:** **vetëm** nëse receta është në **Supabase** dhe shitja kalon **cloud**; shitje restoranti **desktop** **nuk** ul stokun e domates/sallate/djathë automatikisht.

---

### Modeli AI, thirrja, kosto e vlerësuar

| Lloji | Provider (kod) | Model default | Env |
|-------|----------------|---------------|-----|
| Chat asistent pronari | **Anthropic** (i detyrueshëm) | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Raport ditor/javor, supply, waiter, stock analyze | `getAiConfig()` | **OpenAI** `gpt-4o-mini` nëse ka `OPENAI_API_KEY`, else **Anthropic** `claude-sonnet-4-6` | `AI_PROVIDER`, `OPENAI_*` |
| Skanim menu/faturë | **Anthropic vision** | `claude-sonnet-4-6` | `ANTHROPIC_VISION_MODEL` |
| Master off | — | — | `AI_PAUSED=1`, `AI_ENABLED` në `aiConfig.js` |

**Kosto e brendshme (vlerësim `aiPricing.js`, EUR / 1000 tokenë — jo faturë Anthropic/OpenAI):**

| Feature | Rate default | Shembull (~2000 token) |
|---------|--------------|-------------------------|
| chat / raport | 0,00025 € / 1k | ~0,0005 € |
| scan menu/invoice | 0,0023 € / 1k | ~0,005 € |
| Limit | `clients.ai_monthly_token_limit` | `assertAiTokenLimit` |

---

### Lista: ekziston vs mungon (për vizionin «AI + stok i plotë hotel»)

| Ekziston | Mungon / dobët |
|----------|----------------|
| Panel AI 3 tab + FAB chat | Një burim i vetëm i shitjeve për AI (tani **snapshot a** + **`sales_orders`** të ndara) |
| Snapshot PC → cloud (rruga **a**) | `profitForecast` / `ai-stock-predict` / weekly **top_items** pa **`sales_orders`** ose pa top_items nga snapshot |
| Raport AI ditore + historik `ai_daily_reports` | `order_count` / analiza porosish nga POS desktop |
| Skanim faturë → radhë → desktop blerje | Skadencë, parti, FIFO |
| Inventar përbërësish cloud + sugjerime furnizimi | Lidhje recetë në UI; sync recetë desktop↔cloud |
| Receta backend cloud për shitje cloud | Zbritje përbërësish për **`closeTable` desktop** |
| Thyerje/humbje desktop → snapshot `breakage_loss` | AI që lexon thyerjet nga snapshot (s’ka ende feature AI dedikuar) |
| Pako 3 = AI (`hotelPackageTier`) | UI harmonizuar **Pako 3** (website legacy p4 = tier tjetër) |

**Verifikim (lexim kodi):** grep/read skedarët e sipërm — **pa** thirrje live API / UI (audit dokumentar).

---

## 2026-10-10 — Moduli «Thyerje dhe humbje»

### Para ndryshimit (lexim kodi)

| Pyetje | Përgjigje |
|--------|-----------|
| **Rregullim manual stoku sot** | Admin → menu → ndryshim `stock_qty` → `updateMenuItem` → `setMenuItemStockAbsolute` → `logManualStockSetDelta` / `stock_manual_adjustments` (`database.js` ~2510–2548, ~11047–11064). Krahasim: `GET /api/admin/stock/reconcile` (`server.js` ~5207). |
| **Arsye e strukturuar + kostë humbje?** | Vetëm **shënim** + **operator** në histori manual; **jo** arsye enum; **jo** shpenzim / fitim automatik nga humbja. |
| **MARKET (vetëm lexim)** | **Nuk** ka modul dedikuar thyerje/humbje stoku; vetëm tekste anësore (p.sh. `kontroll.html` «Produkte të dëmtuara», `kasa.html` arsye kthimi «damaged»). |

### Çfarë u ndërtua

| Skedar | Ndryshimi |
|--------|-----------|
| `stock-breakage-loss.js` | **I ri** — `registerStockBreakageLoss`, listë menu + `hotel_local_inventory`, shpenzim `addExpense` (kategori `humbje`, `vat_rate: 0`), raport `summarizeStockBreakageLoss`. |
| `db-engine.js` | Migrim `stock-breakage-loss-v1`: tabelat `hotel_local_inventory`, `stock_breakage_loss`. |
| `database.js` | `EXPENSE_CATEGORIES` + `humbje`; eksporte API; `adjustMenuItemStockByDelta(..., opts)` për transaksion të brendshëm. |
| `server.js` | `GET /api/stock-breakage/items`, `POST /api/stock-breakage` (kamarier/recepsion/sherbimi/admin), `GET /api/admin/stock-breakage/report`, `POST /api/admin/local-inventory`. |
| `owner-report-snapshot.js` | Fusha `breakage_loss` në përmbledhjen ditore për pronarin. |
| `public/stock-loss.html` | Regjistrim i shpejtë (artikull, sasi, arsye, shënim). |
| `public/waiter.html` | Link «Thyerje / humbje stoku» → `/stock-loss.html` (kamarier + pastrues në të njëjtin panel). |
| `public/admin.html` | Kartë raporti thyerje/humbje në tab Raportet (`ngarkoStockBreakageRaport`). |
| `tests/stock-breakage-loss.test.js` | Provë: stok 50 → −3 → 47; shpenzim 6 €; shitjet pa ndryshim. |
| `tests/run-all.js`, `package.json` | Test + `stock-breakage-loss.js` në `build.files`. |

**Arsyet:** `thye`, `prish`, `skado`, `humb`, `tjeter`. **Kostoja:** mesatar blerje (`getMenuItemCostForCogs`) ose çmim menu; **nuk** hyjnë në shitje / TVSH shitjeje.

### Provë (≤5 min, printerët off)

| Komanda | Rezultati |
|---------|-----------|
| `node tests/stock-breakage-loss.test.js` | **PO** — `stock-breakage-loss.test.js OK` |
| `node tests/protected-functions.test.js` | **PO** — 11/11 |

**Setup i provës:** blerje 100×2 € → stok 50 (`setMenuItemStockAbsolute`) → thyerje 3 copë → stok **47**, `total_cost` **6 €**, `getReports.totalSales` i njëjtë, `expenses_total` +6, fitimi −6.

**Si ta provosh në app:** pas Setup të ri → mbyll programin → hape → kamarier/sherbimi → «Thyerje / humbje stoku»; pronari → Raportet → thyerje/humbje.

---

## 2026-10-10 — Raport pronari rruga **(a)** (PC → cloud)

| Skedar | Rol |
|--------|-----|
| `owner-report-snapshot.js` | Përmbledhje ditore (`getReports`, bilanc, TVSH, ndërrime) |
| `owner-report-sync.js` | Dërgon te cloud; radhë datash; hash ndryshimi |
| `cloud-auto-sync.js` | Çdo 5 min + startup/reconnect |
| `server.js` | Pas mbylljes ndërrimit dhe check-out |

Cloud + migrim **088:** `revolution-hotel-server/PUNA.md` (commit `2a6a39c`). **Setup desktop** i ri për sync live.

**Provë:** `tmp-hotel-accounting-real-path-audit.js` — snapshot arka cash=30 / në dhomë=20; total pronari = `getReports.totalSales` — **PO**.

---

## Instruksion Cursor — kontroll i llogarive (muaj test)

**Kopjo këtë bllok në chat të ri Cursor (HOTEL desktop). MOS build.**

```
Lexo .cursorrules, CLAUDE.md dhe PUNA.md (rregulli i provave E2E). PROJEKTI: VETËM HOTEL (hotel-system/desktop). MOS prek projekte të tjera. MOS build.

DETYRA: Kontroll i llogarive për një muaj test — çdo shumë deri në cent (±0.01 €).

1. **Periudha:** zgjidh një muaj kalendarik test (ose interval të qartë `dateFrom`–`dateTo`) dhe përdor **të njëjtat data** kudo: Raport ditari, `getReports`, Kontabilist (bilanc, libër shitjeje B2B/B2C), shpenzime. Çdo mospërputhje > 0.01 € → raporto **JO OK** + burimi (UI / API / SQL / skedar + rresht).

2. **Të ardhurat (departamentet — një herë secila):** Dhoma (netë akruale), Restorant (arka tavolinë + ushqim në dhomë RS, pa dyfishim `(T#)` me daily_log), Shërbime hoteli; `totalSales` = shuma e departamenteve (jo dyfishim me arkën recepsion). **B2B: fatura numërohet si e ardhur një herë (kur lëshohet). Pagesa (cash RC- ose bankë) s’e rrit më totalin e të ardhurave, vetëm e ul borxhin.**

3. **Arka (para të marra):** ndarje Restorant (cash/kartë) vs Recepsion (CO-/RC-, ndarje dhoma/restorant/shërbime); «Në dhomë» tavolinë veç nga cash i ndërrimit. Pagesa B2B **cash** → vetëm `RC-` në arka recepsion; **bankë** → jo në arka cash.

4. **Shpenzimet:** totali i shpenzimeve të regjistruara në Kontabilist për periudhën = hyrja në bilanc (`SHITJET − BLERJET − SHPENZIMET = FITIMI`); krahaso me listën/rreshtat e shpenzimeve (data, shumë).

5. **Prova:** prefero DB test / skript (≤5 min, printerët off) ose lexim i `database.js` + një thirrje API me session; mos supozo. Raporto tabelë **Pritur | Doli | PO/JO** për çdo kontroll.

Shkruaj rezultatin te PUNA.md (data, periudha, diferencat).
```

---

## 2026-10-10 — Kontroll llogarish muaj test (audit, **pa ndryshime kodi produkti**)

**Periudha:** `2026-03-01` — `2026-03-30` · **DB:** e pastër `%TEMP%` · **`HOTEL_DB_PLAIN=1`** · **Skript:** `node tmp-hotel-accounting-month-audit.js` (≈4 s, pa printer) · **Dalje:** `%TEMP%\hotel-acct-audit-last.json`

### 1. Të dhëna test + çfarë duhet të dalë (paraprakisht)

| Burim | Veprim | Pritje (€ / sasi) |
|--------|--------|-------------------|
| Blerje | 100 copë × **1,00** neto, TVSH 18%, furnitor | Stok **+100**; blerje neto **100** (nëse `unit_price` është neto) · bruto **118** |
| Restorant | 30 ditë × **10** cash + ditë 6 **5** kartë + ditë 11 **4** «në dhomë» | **309** € në arkën restorant (pa anulime) |
| Tavolinë reale | `closeTable` 10× Kafe @ 2,36 | **+23,60** € cash · stok **−10** (vetëm kjo ul `stock_qty`) |
| Anulim | `daily_log` **99** €, status `cancelled` | **0** në shitje / arka |
| Hotel | Check-in 5–8 Mar, **50** €/netë × **3** netë | **150** € netë (akruale) |
| Folio | Sauna **20** · RS Snack **15** | Shërbime **20** + restorant RS **15** *(vetëm nëse `room_charges.created_at` / CO bie në Mars)* |
| Check-out | Cash recepsion | **CO-** në `daily_log` = totali faturës *(data = dita e checkout-it në log)* |
| B2B | Faturë **100** € (pa TVSH) + pagesa **40** cash + **60** bank | Të ardhur **100** një herë në libër; arka recepsion **+40** cash; pagesa bankë jo në arka |
| Shpenzime | qera **200** + sherbime **45** + paga **500** + tjeter **30** | **775** € në bilanc |
| Raporte | Σ 30 ditë = muaj; 7 ditë = java | `getReports` = `getDitari` për total departamentesh |

**Pritje ideale totalSales (departamente, pa B2B):** **150 + 20 + 309 + 15 = 494 €** (plus **23,60** € nëse `closeTable` hyjnë në të njëjtën ditë kalendarike).

### 2. Tabela kontrolli — Pritur → Doli → PO/JO

| Kontroll | Pritur | Doli | PO/JO |
|----------|--------|------|-------|
| Ditari = raport (3 ditë provë) | 10 / ditë | 10 | **PO** |
| Muaj = shuma 30 ditë `totalSales` | 459 | 459 | **PO** |
| Java = shuma 7 ditë | 225 | 225 | **PO** |
| Ditari mujor = `getReports.totalSales` | 459 | 459 | **PO** |
| Departamentet: netë + shërbime + restorant | 494* | **459** (150 + **0** + 309) | **JO** * |
| B2B pagesë nuk rrit `getReports.totalSales` | i njëjti | 459 | **PO** |
| Shpenzime → `getKontabilistiBilanc.expenses_total` | 775 | 775 | **PO** |
| Fitimi = shitje − blerje − shpenzime | −370,9 | −370,9 | **PO** |
| Blerje neto (Kontabilist / ATK) | 100† | **84,75** | **JO** † |
| Shitje neto bilanc (B2C+B2B) | — | **488,85** (388,85 + 100 B2B) | *(referencë)* |
| COGS = sasi×kosto mesatare blerje (Mar) | 40‡ | **32** | **JO** ‡ |
| Fitim bruto = shitje neto − COGS | — | 456,85 (forcuar) | **PO** (±5 €) |
| Stoku libër: 100 − shitje (log+close) | 60 | **58** (42 të shitura) | **JO** |
| Stoku fizik `stock_qty` | 90 | 90 | **PO** |
| Stoku `expected_stock` = `actual_stock` | 58 | **90** (devijim **32**) | **JO** |
| Vlera stokut @ kosto blerje | 90 | 90 | **PO** |
| Arka ndërrim: cash i ndërrimit vs shitje cash | ~304+ nga log | **23,60** (vetëm `closeTable` me `shift_id`; **304 €** orphan `shift_id` NULL) | **JO** |
| Pagesa «në dhomë» në ndërrim | ≥ 4 | **0** | **JO** |
| TVSH libri shitje vs deklaratë | përputhen | përputhen | **PO** |
| Norma TVSH menu | 0 / 8 / 18 | **Audit Kafe = 18** | **PO** |
| B2B në libër shitjeje | 1 faturë | 1 | **PO** |
| Panel pronari cloud = PC | totalet e njëjta | **nuk u provua** (vetëm DB lokale) | **JO** (scope) |

\* **Shërbime 0 €** dhe **RS 15 €** mungojnë në Mars sepse `room_charges` marrin `created_at` = koha e skriptit (**2026-10-10**), jo datën e folios; `getReports` filtron `date(created_at)` në interval. Netët **150 €** dalin nga akruale (`guests`), jo nga `created_at` charges.

† **84,75 €** = neto nga `purchaseInvoiceNetTotal` (TVSH 18% e ndarë nga bruto); nëse `unit_price` duhet të jetë neto **1,00**, bilanci **NUK** përputhet me pritjen **100 €**.

‡ **32 copë** = vetëm shitjet `daily_log` **brenda Marsit**; `closeTable` (**10 copë**) regjistrohet me datën **sot** → jashtë COGS Mars.

**Arka restorant (muaj):** cash **300** + kartë **5** + në dhomë **4** = **309 €** (`byRegister`).

### 3. TVSH në program

| Vend | Normat |
|------|--------|
| `menu_items.vat_category` | **0**, **8**, **18** (`database.js` ~2230) |
| `services.vat_category` | e njëjta |
| Blerje | `vat_rate` për rresht / faturë (`purchase_invoice_items`) |
| B2B / faturë shitje | TVSH sipas cilësimeve faturës (`vat.enabled`, `percent`) |
| Kontabilist | `getAtkSalesVatBook` / `getAtkVatDeclaration` — në këtë run **PO** (total TVSH libër = deklaratë) |

### 4. Shpenzime dhe thyerje (lexim kodi)

| Pyetje | Përgjigje |
|--------|-----------|
| Vend për shpenzime jo-mall (gota, qira, rrymë, paga, detergjent…)? | **PO** — modul **Shpenzime**, kategori `qera`, `pastrim`, `sherbime`, `paga`, `papritur`, `tjeter` (`database.js` ~11397). |
| Hynë te kontabiliteti / fitimi? | **PO** — `expenses_total` në `getKontabilistiBilanc`; formula fitimi neto **− shpenzimet**. |
| Modul thyerje (gota e thyer, mall i prishur)? | **PO (nga 2026-10-10)** — moduli «Thyerje dhe humbje» (`stock-breakage-loss.js`, `/stock-loss.html`); shih seksionin e sipërm. Më parë: vetëm ndryshim manual stoku. |

### 5. Gabime / mospërputhje (sipas rëndësisë) — **pa fix**

| # | Rëndësi | Problemi | Skedar + rresht (referencë) |
|---|---------|----------|-----------------------------|
| 1 | **Lartë** | **Stoku:** shitjet në `daily_log` (insert / historik) **numërohen** në `reconcileStock` por **nuk** zbresin `stock_qty` — vetëm rrugë si `closeTable` → `decrementMenuItemStock` (~10634, ~7934). Devijim **32** copë në audit. | `database.js` ~10871–10908 vs ~10634 |
| 2 | **Lartë** | **Arka ndërrimi:** `getWaiterShiftSummary` / `computeShiftTotals` filtrojnë `shift_id`; hyrjet me `staff_id` por **`shift_id` NULL** mbeten «orphan» (**304 €** cash në audit) — cash i ndërrimit **23,60 €** vs shitje cash reale. | `database.js` ~9595–9661 |
| 3 | **Mesatar** | **Raport hoteli vs folio:** `room_charges` raportohen me `date(created_at)` — charges/checkout CO me datë **aktuale**, jo datën e biznesit → shërbime/RS/recepsion **0** në Mars edhe kur mysafiri është Mar 5–8. | `database.js` ~8558–8565, ~32146–3258, ~13094–13098 |
| 4 | **Mesatar** | **COGS periudhë:** `closeTable` / `addDailyLogEntry` pa `date` → shitje **jashtë** intervalit raport → COGS **32** vs **40** copë. | `database.js` ~10928–10959, ~13094–13098 |
| 5 | **Mesatar** | **Blerje neto bilanc:** **84,75 €** vs pritje **100 €** neto — kontrolloni nëse `unit_price` blerje regjistrohet **bruto** me TVSH. | `kontabilisti-atk.js` ~465–471 |
| 6 | **Ulët** | **Dy lexime shitjesh:** `getReports.totalSales` **459 €** (departamente, pa B2B) vs `getKontabilistiBilanc.sales_total` **488,85 €** (libër, me B2B) — **duhet** kuptuar si burime të ndryshme, jo bug i vetëm. | `database.js` ~8660–8662, ~12393–12416 |
| 7 | **Info** | **Cloud pronari:** nuk u krahasua me PC (kërkon API / panel). | — |

### Verifikim (ky hap)

- **Provova:** `node tmp-hotel-accounting-month-audit.js` → `%TEMP%\hotel-acct-audit-last.json`, exit **1** (6 kontrolle **JO**).
- **Rezultati:** raportet ditore/mujore/javore dhe shpenzimet **PO**; stoku, ndërrimi, departamentet hotel (shërbime/RS), COGS/blerje **JO** si në tabelë.
- **Kodi produkti:** **nuk u ndryshua** (vetëm skripti provë `tmp-hotel-accounting-month-audit.js`).
- **⚠️ Vlerësim:** audit i mësipërm **nuk është provë e vlefshme** për stok/ndërrim — përdorte **INSERT direkt** në `daily_log`. Shih seksionin **rrugë reale** më poshtë.

---

## 2026-10-10 — Kontroll llogarish (rrugë **reale** API, pa fix)

**Skript:** `node tmp-hotel-accounting-real-path-audit.js` (~13 s) · DB `%TEMP%` · server lokal **:3995** · **`fiscal_skip`** · printerët off · **Dalje:** `%TEMP%\hotel-real-audit-last.json`

**Rruga:** `POST /api/waiter/shift/open` → `POST /api/orders` → `POST /api/orders/close` (cash + room) · `POST /api/purchases` · hotel: rezervim/CI/add-service/CO (API recepsion).

### Pritur → Doli → PO/JO → shkaku

| Kontroll | Pritur | Doli | PO/JO | Gabim programi / skripti |
|----------|--------|------|-------|---------------------------|
| Blerje stok +100 | 100 | 100 | **PO** | — |
| **100 € me TVSH** (unit×sasi) | 84,75 + 15,25 = 100 | total=100, neto bilanc=**84,75** | **PO** | **Skripti i vjetër** priste neto=100 — **gabim i skriptit**. Programi: `unit_price` → `line_total` **bruto** (`kontabilisti-atk splitGross`). |
| Shitje `closeTable`: stok −10 / −4 | 90 → 86 | 90 → 86 | **PO** | Audit i vjetër (**INSERT** log) ishte **gabim i skriptit** — stoku **nuk** zbret pa `closeTable`. |
| COGS (14 copë × 1,00) | 14 | 14 | **PO** | — |
| Stoku reconcile expected=actual | 86 | 86 | **PO** | Devijimi 32 i auditit të vjetër = **gabim i skriptit** (INSERT pa zbritje stoku). |
| `daily_log.shift_id` pas mbylljes | të gjithë >0 | **1,1** | **PO** | Orphan 304 € i auditit të vjetër = **gabim i skriptit** (`shift_id` NULL në INSERT). |
| Ndërrim: cash vs «në dhomë» | cash≈23,60 room≈9,44 | cash=**33,04** room=**0** | **JO** | **Gabim i programit:** `server.js` `normalizeSplitMethod` (~305) **nuk** mapon `room` → bie në `cash`; `database.js` `normalizePaymentMethod` e di `room`, por `/api/orders/close` përdor `resolvePaymentFromBody` → `normalizeSplitMethod`. |
| Shërbime hoteli (sot, API) | hotelServices>0 | co=**400**, services=0 | **JO** | **Pjesërisht skript** (flow rezervim/CO në DB të re); **nuk** përfundoi check-out — duhet provë manuale recepsion. |
| Datë e caktuar charge/shërbim | param `date` | vetëm `created_at=now` | **JO** | **Gabim i programit** (mungon backdate API) — prova Mars e vjetër = **gabim i skriptit**. |
| Ditari = `getReports` (sot) | i njëjti | 33,04 | **PO** | — |
| Panel cloud = PC | totalet e njëjta | nuk u krahasua live | **JO** | **Dizajn / program:** cloud `getOwnerReport` = `sales_orders` Supabase (`revolution-hotel-server` ~879), **jo** `getReports` (netë, CO, B2B). Pa `kitchen_key`/sync = **nuk provohet** krahasimi numerik. |

### Përmbledhje audit i vjetër vs rrugë reale

| Tema | Audit INSERT (i pavlefshëm) | Rrugë reale |
|------|----------------------------|-------------|
| Stoku | JO (devijim) | **PO** |
| Ndërrim / shift_id | JO (orphan) | shift_id **PO**; ndarja cash/room **JO** (API) |
| Blerje 84,75 | JO (pritje neto 100) | **PO** (100 bruto) |
| COGS | JO (Mars + INSERT) | **PO** (sot) |
| Mars shërbime/RS | JO | **N/A** — backdate **JO**; provo **ditën e sotme** |

### Verifikim

- **Provova:** `node tmp-hotel-accounting-real-path-audit.js` → `%TEMP%\hotel-real-audit-last.json`, exit **1** (4 **JO**, 9 **PO**).
- **Kodi produkti HOTEL:** **pa ndryshime** (vetëm skript provë i ri).

---

## 2026-10-10 — Fix: pagesa «Në dhomë» (room) në ndërrim / API / mixed

### Para ndryshimit — ku normalizohet pagesa (HOTEL desktop)

| Vend | E njeh `room`? | Shënim |
|------|----------------|--------|
| `database.js` ~7781 `normalizePaymentMethod` | **PO** | `room`, `ne_dhome`, `në_dhomë`, `charge_to_room`, … |
| `database.js` ~7824 `resolveDailyLogPaymentSplit` | **PO** (por bug mixed) | Room jo në cash/card; **mbetja shkonte te cash** |
| `database.js` ~8961 `SHIFT_DAILY_LOG_PAYMENT_TOTALS_SQL` | **PO** vetëm `payment_method='room'` | **JO** për pjesën room në `mixed` |
| `database.js` `closeTable` / `addDailyLogEntry` | **PO** | Përdor `normalizePaymentMethod` |
| `server.js` ~305 `normalizeSplitMethod` | **JO** | Binte në `cash` — shkaktari i `/api/orders/close` |
| `server.js` ~328 `resolvePaymentFromBody` | **JO** (indirekt) | Split + body përmes `normalizeSplitMethod` |
| `fiscal/fiscal-print.js` ~551 `normalizeSplitMethod` | **JO** | Kupon fiskal / ndarje print |
| `cloud-sync.js` | **PO** | `db.normalizePaymentMethod` |
| `sales-invoices-service.js` | **PO** (B2B) | Metoda tjera — jo tavolinë |
| `shift-report-html.js` | **PO** | Shfaq `room_total` nga DB |
| `public/js/fiscal-mixed-payment.js` | N/A | Vetëm cash/card/voucher — jo UI «në dhomë» tavolinë |

### Ndryshimet (skedar + rresht)

| Skedar | Ndryshimi |
|--------|-----------|
| `server.js` ~305–329 | `normalizeSplitMethod`: delegon te `db.normalizePaymentMethod` për **room** (+ aliaset); listë eksplicite `room` |
| `database.js` ~7840–7859 | `resolveDailyLogPaymentSplit`: **mos** shto mbetjen e mixed te cash kur ka split **room** |
| `database.js` ~8975–8980 | `room_total` SQL: pjesë room nga `mixed` = `total − cash_amount − card_amount` |
| `fiscal/fiscal-print.js` ~551–574 | `room` në split + etiketë «Në dhomë» në kupon |
| `tests/protected-functions.test.js` | Test i ri: mixed 10 cash + 5 room → shift |
| `tmp-hotel-accounting-real-path-audit.js` | Skenar: 20 cash + 15 room + 10+5 mixed; arka 50 |

### Prova (pas fix)

| Prova | Rezultat |
|-------|----------|
| `node tests/protected-functions.test.js` | **11/11** (përfshirë mixed cash+room) |
| `node tmp-hotel-accounting-real-path-audit.js` | **Ndërrim cash=30, room=20, arka 50, mbyllje OK** — **PO**; 3 JO të vjetra (hotel CO skript, backdate, cloud) |

**Pas Setup:** mbyll app → hape → mbyll tavolinë «Në dhomë» / mixed → kontrollo ndërrimin.

---

## 2026-10-10 — Audit: raport pronari (cloud) vs PC — **pa ndryshime kodi**

**Status:** vetëm analizë + rekomandim; **prit OK** nga Naseri para implementimit.

### Cloud — nga çfarë llogaritet?

| UI / API | Burimi Supabase | Si llogaritet |
|----------|-----------------|---------------|
| Tab **Raport** (`owner.js` → `GET /api/owner/reports`) | **`sales_orders`** | `status = 'closed'`, filter **`closed_at`**, **total = Σ porosi** (`getOwnerReport` ~879–950) |
| **Statistika** sot/javë/muaj (`getOwnerStats` ~731) | **`sales_orders`** | E njëjta: `sumSales` ~683–698 |
| **Shpenzime** pronari | **`owner_expenses`** | CRUD cloud (`ownerExpenseService.js`) — **jo** `expenses` SQLite PC |
| **AI daily report** | **`sales_orders`** përsëri | `buildDailyReportPayload` → `getOwnerReport` (`aiDailyReportService.js` ~134) |
| Tavolina live | **`sales_orders`** active | Jo raport i ardhurave totale |

**Si mbush `sales_orders`:** desktop `cloud-sync.js` `pushSale` / `pushSaleSync` → `POST /api/v1/sales/sync` → `syncSaleFromPos` → upsert rresht **porosie tavoline** (items, total, `closed_at`, `device_id`, …). **Nuk** është kopje e `daily_log`.

### PC — nga çfarë llogaritet?

| Raport | Burimi | Si llogaritet |
|--------|--------|---------------|
| **`getReports` / ditari** (`database.js` ~8638+) | **`daily_log`** (completed) + **`collectHotelReportRevenue`** | **Restorant:** shuma `daily_log` pa CO-/RC- + RS nga **`room_charges`**. **Hotel:** netë akruale (`guests` + `rooms`), shërbime/ushqim jo-(T#) nga **`room_charges`**. **`totalSales` = netë + shërbime + restorant** (pa dyfishim recepsion në total). |
| **Arka recepsion** | **`daily_log`** CO- / RC- | `aggregateReceptionCollected` — **nuk** hyjnë si `totalSales` departamenti por si **para të marra** |
| **Kontabilist** | **`getSalesLedger`**, blerje, **`expenses`** SQLite | B2B, B2C, TVSH, blerje, shpenzime — **model tjetër** nga tab Raport cloud |

### Çfarë **nuk** përdoret / nuk arrin për raportin cloud aktual

| Të dhëna PC | Sync në cloud? | Përdoret nga `getOwnerReport`? |
|-------------|----------------|--------------------------------|
| Netët hoteli (akruale) | `guests` / rezervime (`hotel-cloud-sync`) | **JO** |
| Shërbime / RS (`room_charges`) | `pushChargesToCloud` | **JO** |
| Check-out CO-/RC- (`daily_log`) | **JO** si raport | **JO** |
| **`daily_log`** (libri i plotë) | **JO** (vetëm porosi → `sales_orders`) | **JO** |
| Ndërrime / mbyllje arke | **JO** | **JO** |
| Faturat B2B + pagesat | **JO** | **JO** |
| Shpenzime Kontabilist (`expenses`) | **JO** (cloud ka `owner_expenses` veçmas) | **JO** |
| Blerjet / stok kontabilist | **JO** për raport | **JO** |

**Pse numrat ndryshojnë:** cloud = **vetëm mbyllje tavoline** në `sales_orders`; PC = **hotel + restorant + shërbime** nga burime të ndryshme; plus **datë** (`closed_at` UTC vs `daily_log.date` lokale), offline pa push, porosi web vs POS (`listClosedWebWaiterSalesForPos` filtron POS për import — logjikë e ndarë).

### Rrugët e mundshme

| | (a) PC llogarit → dërgon përmbledhje ditore | (b) Cloud rillogarit nga raw |
|--|-----------------------------------------------|------------------------------|
| **Ideja** | Një herë `getReports` / ditari në PC → sync fusha: `total_sales`, `hotel_nights`, `hotel_services`, `restaurant_sales`, … për çdo **ditë** | Replikim i plotë i `daily_log` + guests/charges + i njëjti kod SQL në server |
| **Pro** | **Një burim i vetëm llogarie** (SQLite PC); pronari lexon të njëjtin total si admin; offline-first (radhë sync) | Cloud “i pavarur” pa PC online |
| **Kundër** | Duhet skemë + sync i besueshëm | Dy implementime `getReports` → risik ** përsëri dy numra**; më shumë të dhëna + migrime |

**Rekomandim (agreement me Naseri): (a)** — PC mbetet burimi i së vërtetës; cloud panel **lexon snapshot** të sync-uar (jo `Σ sales_orders.total` si “të ardhura totale hoteli”).

**Hapi tjetër:** pas **OK** të qartë — dizajn tabelë/API sync + ndryshim `getOwnerReport` / UI që të lexojë snapshot-in (projekt i veçantë desktop + hotel-server).

---

## 2026-10-10 — B2B: pagesat e faturave + borxhe

### Para ndryshimit (audit)

| Pyetje | Përgjigje |
|--------|-----------|
| Si regjistroheshin pagesat? | **Asnjë** — vetëm CRUD faturë (`sales-invoices-service.saveInvoice`); **nuk** kishte `POST .../payments` → **404** (`sales-invoices-routes.js`). |
| Tabelë pagesash / borxh? | **Jo** — `sales_invoices` pa `amount_paid` / `payment_status`. |
| UI | Admin Faturat A4 — pa formë pagese. |
| **MARKET** (lexim) | `amount_paid`, `payment_status` në `sales_invoices`; `paySalesInvoice(id, amount)`; route `POST /api/b2b/sales-invoices/:id/pay`. |
| **DISTRIBUTOR** (lexim) | I njëjti model: `paySalesInvoice` + route `/api/b2b/sales-invoices/:id/pay`. |

### Çfarë u ndërtua

- **DB:** `amount_paid`, `payment_status` në `sales_invoices`; tabela `sales_invoice_payments` (datë, shumë, mënyra, shënim, `daily_log_id`).
- **API:** `POST/GET /api/admin/sales-invoices/:id/payments`, `GET .../business-debts`.
- **Logjikë:** pagesë e plotë/pjesshme; status `unpaid` / `partial` / `paid`; borxh = total − paguar; **cash/kartë** → `recordRecepcionKasaSale` (arka recepsion); **bankë** → vetëm ledger pagese (jo arka).
- **UI:** `sales-invoices-ui.js` — tabelë borxhesh, kolona pagese, modal «Regjistro pagesën».

### Verifikim

| Prova | Rezultat |
|-------|----------|
| `node tests/hotel-b2b-payments.test.js` | Faturë **100** → **40** cash (borxh **60**) → **60** bank → **paid**, borxh **0**; arka recepsion **+40** vetëm |
| `node tests/run-all.js` | **6/6** suite |

**Pas Setup:** mbyll app → hape → Admin → Faturat A4 → «Pagesë» te fatura B2B.

---

## 2026-10-10 — Raporti i ditës (ditari) — netët / shërbime / arka

### Si llogaritej **para** fix (audit ~8502–8524)

| Fushë | Burimi | Kur numërohej |
|-------|--------|----------------|
| **hotelNights** | `accrueHotelNightsForRange` → `guests` + `rooms.price_per_night` | **Akruale:** çdo ditë kalendarike që mysafiri “mbulon” (`check_in ≤ ditë < check_out` për **active**). |
| **hotelServices** | `room_charges` (jo ushqim) | **Kur krijohet** charge (`created_at` në interval). |
| **restaurantSales** (departamenti) | `daily_log` (jo CO-/RC-) + (pas fix) ushqim në dhomë **RS** nga `room_charges` | Tavolinë: **kur mbyllet** tavolina; RS në dhomë: kur regjistrohet charge. |
| **receptionSales** / **reception_collected** | `daily_log` me `CO-` / `RC-` | **Kur paguhet** check-out / kasa recepsion. |
| **totalSales** (gabim i vjetër) | shpesh përfshinte edhe `receptionSalesNet` → **dyfishim** me netët/charges. |

**Netët:** akruale sipas ditës së fjetur, **jo** vetëm në check-out. **Shërbimet:** kur regjistrohen në folio; **paratë** recepsionit kur bëhet CO.

### Shkaktarët e bug-ut të raportuar

1. **`loadCheckoutGuestIdsInReportRange` + `skipGuestIds`** — mysafirët me CO në interval ** përjashtoheshin** nga akruale dhe shpesh nga `room_charges` → **Shërbime = 0** ndërsa **reception_collected** tregonte 48 € (pagesa CO).
2. **`guestStayOverlapsDay` pas check-out** — `check_out_date` përditësohet në ditën e daljes → kushti `check_out > ditë` bëhej false → **netët humbnin** (60 → 60 edhe pas pagesës).
3. **Ushqim `(T#)` në folio** — dyfishohej me `daily_log` (pagesë «në dhomë» në tavolinë).
4. **`getDitari({ dateFrom, dateTo })`** — `resolveDitariRange` **injoro** datat custom → vetëm «Sot» → totali i ditarit **≠** raporti multi-ditë.

### Rregulli i miratuar (implementuar)

- **Departamentet (një herë):** `totalSales = hotelNights + hotelServices + restaurantSales`, ku `restaurantSales = arka restorant (daily_log) + ushqim në dhomë (RS / jo T#)`.
- **Arka:** `byRegister` + `reception_collected` (dhoma / restorant / shërbime); «në dhomë» tavolinë **veç** te ndërresa kamarierit, jo dyfish në total departamenti.
- **Pas check-out:** netët mbeten sipas `hotelNightsBetween(check_in, check_out)` (si fatura).

### Ndryshime (`database.js`)

- `collectHotelReportRevenue` — pa `skipGuestIds`; food → `restaurantRoomFood` / services; skip `(T#)` për dyfishim.
- `getReports` / `getDitari` — total pa dyfishim recepsionit.
- `guestStayOverlapsDay` — rrugë e veçantë për `checked_out`.
- `resolveDitariRange` — respekton `dateFrom` / `dateTo`.
- `getHotelRevenueReport` — i njëjti model departamentesh (pa skip checkout).

### Verifikim

| Prova | Rezultat |
|-------|----------|
| `node tests/protected-functions.test.js` | **10/10** (total +60 pa dyfishim tavolinë+folio T7) |
| `node tests/run-all.js` | **5/5** suite |
| `node tmp-hotel-e2e-ditari-report.js` | **ok:true** — Dhoma **60**, Restorant **30**, Shërbime **15**, Total **105**; arka recepsion cash **85**, restorant **20**; `ditariTotal` **105** (DB e pastër `%TEMP%`, `HOTEL_DB_PLAIN=1`, ≤5 min, pa print) |

**Pas Setup të ri:** mbyll programin plotësisht → hape përsëri → raporti / ditari për intervalin e testuar.

---

## Rregull — prova E2E / audit (obligativ)

1. **Para `node server.js` test:** përdor **vetëm** kopjen `%TEMP%\hotel-e2e-audit-*\hotel.db` (`DB_PATH=…`), **jo** DB e app-it të instaluar.
2. **Printim:** **çaktivizo të gjithë printerët** në kopjen e DB (ose nise serverin me printim të fikur / env që bllokon spooler) — **asnjë provë nuk printon** në printer fizik (kupon kuzhinë, fiskal, etj.).
3. **Kohë:** një skript provë **≤ 5 minuta**. Nëse zgjat → **ndalo** (`Stop-Process` / `taskkill`), raporto, **mos** lësho `sync-all` ose loop të gjatë në background.
4. **Port test:** **3995** (ose tjetër i dedikuar) — pas provës **mbyll** serverin test; **mos** prek procesin Electron / serverin e instaluar (zakonisht **3001**).

---

## 2026-10-10 — Diagnozë QR 400 (run 2) + faturë €0 + fix

### Log provash të kaluara (pa supozim)

| Run | QR HTTP | Body `gabim` (cloud) |
|-----|---------|----------------------|
| **2** (567997.txt) | **400** | **`Dhoma nuk ka mysafir aktiv as rezervim — porosia nuk pranohet.`** — `guestHotelService.js` `resolveRoomTarget` (~224), `code: ROOM_UNAVAILABLE` |
| **3** (567997.txt) | 201 | — (pas deploy + push; run i njëjtë skripti) |
| **Shërbim** (567997.txt, dhoma 207) | **400** | **Nuk u logua `qr_gabim`** në JSON; shkaku i njëjtë: **mysafir mungon në cloud** (pa `push-guest-stays` pas check-in) ose **`service_id` i gabuar** (UUID vs `local_service_id`) |

### Çmimi 0 pas PRANO

| Burimi | Si llogaritet |
|--------|----------------|
| **Cloud** (`mapOrderLines`) | `pos_menu_items.price` në Supabase; klienti mund të dërgojë `price` në body — nëse **0**, mbetej **0** |
| **PC** (`mapCloudItemsToLocal` → `addRoomChargesFromOrderItems`) | `it.price` nga porosia cloud; fallback **`menu_items.price` lokal** vetëm kur `price` **mungon** (`??`), **jo** kur është **0** |
| **Provë** | Artikulli **Gin** `price=3` në kopje; `charges_total=0` sepse **nuk krijohej** `room_charge` (porosia nuk hidratej nga `items_json` te PRANO), **jo** sepse çmimi ishte 0 |

### Ndryshime (fix)

| Skedar | Çfarë |
|--------|--------|
| `database.js` | `mapCloudItemsToLocal` — çmim katalog kur cloud dërgon 0; `resolveGuestRoomTarget` — mysafir aktiv mjafton; `hydrateCloudOrderForAccept`; menu dhomë në `importCloudOrderToLocal` |
| `server.js` | `POST /api/cloud-sync/push-guest-stays`; PRANO përdor `hydrateCloudOrderForAccept` |
| `printer.js` | `HOTEL_AUDIT_DISABLE_PRINT=1` → skip spooler |
| `tmp-hotel-e2e-prep.js` | `AUDIT_DISABLE_PRINTERS=1` → `printers.enabled=0` |
| `tmp-hotel-e2e-qr-single.js` | Një provë ≤5 min, pa `sync-all` |
| `revolution-hotel-server` `guestHotelService.js` | Çmim katalog; `lookupHotelServiceRow` (push **`cd77e98`**) |

### Verifikim (1×, kopje DB, :3995, print off)

`tmp-hotel-e2e-qr-single.js` — **~86s**: menu QR **201** → kamarier pending **PO** → PRANO **200** → **`charges_total=3`**, **1** rresht; shërbim QR **201** → recepsion pending **PO** / kamarier **JO**. Cloud pastruar (`AUDIT-QR-%`).

---

## 2026-10-10 — QR dhomë ushqim → kamarier PRANO + faturë një herë

### Para ndryshimit (audit)

| Pyetje | Gjendje |
|--------|---------|
| **Body 400 PRANO (3×)** | Testi përdorte **recepsion** + porosi klasifikuar gabim; mesazhe të mundshme: `Porosia nuk u gjet…` (`server.js` ~549–553), `Importimi i porosisë dështoi` (~679–681), ose **403** «Porosi restoranti… vetëm kamarieri» (~580–586) / «pranoni nga recepsioni» (~592–595). |
| **`database.js` ~7162** | `isRecepcionAcceptPendingOrder` = alias i `isRecepcionCloudPendingOrder`. Menu dhomë **duhet** `false` te ~7135, por fallback **`return true`** (~7139 i vjetër) për çdo QR me `room_number` pa `order_kind` → recepsion. **waiter.html** ~1640–1649 e filtron menu dhomë te kamarieri — **mospërputhje** me fallback server. |
| **Dyfishim faturë** | Cloud `submitGuestMenuOrder` (occupied) vendoste **`folio_pre_applied: true`** + `insertRoomCharges` në Supabase; PC `tryApplyCloudRoomMenuOrder` skip charge lokale (~7044) → rrezik mungesë/ dyfishim. |

### Ndryshime

| Skedar | Çfarë |
|--------|--------|
| `database.js` ~7133–7145 | Fallback room QR: **WEB-GUEST-ROOM / kitchen → kamarier**; minibar/shërbim → recepsion |
| `database.js` ~7023–7075, ~3267+ | Faturë lokale një herë: `cloud_order_id` në përshkrim; idempotencë `cloud:{uuid}` |
| `server.js` ~592–595 | Mesazh 403 i qartë (shërbim vs menu dhomë) |
| `revolution-hotel-server` `guestHotelService.js` | Occupied menu: **jo** charge në cloud para PRANO; `folio_pre_applied: false` |
| `revolution-hotel-server` `cloudOrderRoles.js` | I njëjti routing si desktop |

### Verifikim (kopje DB, server **:3996** — 3995 i zënë)

`tmp-hotel-e2e-qr-room-waiter.js` — 3×: QR **201**, pending **kamarier PO / recepsion JO**, **accept 200** (×3); run 2–3 **1 charge** pas PRANO, **pa dyfishim** pas PRANO të dytë. Shërbim QR cloud **400** (service_id lokal ≠ katalog cloud — provë e paplotë).

**Deploy cloud:** push `revolution-hotel-server` — pas Railway, menu occupied nuk aplikon më folio në cloud para PRANO.

---

## 2026-10-10 — Fix: push cloud menjëherë pas check-in nga rezervimi (+ vende të tjera PMS)

### Inventar (para ndryshimit) — ndryshim status mysafir/dhomë vs cloud push

| Veprim | Rruga (Admin / Recepsion) | `pushHotelGuestStayToCloudAsync` | `pushHousekeepingToCloudAsync` | `pushHotelReservationsToCloudAsync` |
|--------|----------------------------|----------------------------------|--------------------------------|--------------------------------------|
| Check-in **direkt** | Admin ~3687 / Recepsion ~3890 | **PO** ~3694 / ~3897 | — | — |
| Check-in **nga rezervimi** | Admin ~4342 / Recepsion ~4438 | **JO** | — | — |
| Check-out | Admin ~3719 / Recepsion ~3922 | **PO** ~3731 / ~3979 | — | — |
| Pastrim dhomë (free) | Admin ~3738 / Recepsion ~4042 | — | **JO** | — |
| HK assign/start/complete/… | Recepsion ~4062–4116 | — | **PO** | — |
| Rezervim create/update/cancel | Admin ~4312–4332 / Recepsion ~4408–4428 | — | — | **JO** |
| **Ndërrim dhomë** / **zgjatje qëndrimi** (API dedikuar) | — | **N/A** (nuk ka route në `server.js`; vetëm ndryshim datash rezervimi para CI) | — | — |
| Shërbim në dhomë / charge restorant | ~4247 / ~4452 | — | — | — (charges: vetëm `fullHotelSync`) |

### Ndryshime (`server.js`)

- **`pushHotelReservationsToCloudAsync`** (~54–67) — rezervime + dhoma.
- **Check-in rezervimi:** `pushHotelGuestStayToCloudAsync` te Admin ~4346, Recepsion ~4444.
- **Pastrim dhomë:** `pushHousekeepingToCloudAsync` te Admin ~3742, Recepsion ~4048.
- **Rezervime CRUD:** `pushHotelReservationsToCloudAsync` te create/update/cancel (admin + recepsion, ~6 route).

### Verifikim (3×, kopje DB :3995, pas **restart** server me kod të ri)

Skript: `tmp-hotel-e2e-ci-cloud-push.js`. Dhoma **102–104** u pastruan lokalisht + cloud (`free`).

| Run | CI | Cloud (QR 201 ≤10s ⇒ mysafir në cloud) | QR `menu-order` | Pranim lokal (`online-orders/accept`) |
|-----|-----|------------------------------------------|-----------------|----------------------------------------|
| 1 | 200 | **~2.2s** | **201** | **400** (pas fix `order_id` — porosi occupied me `folio_pre_applied` në cloud; shih `guestHotelService.js` ~641–674) |
| 2 | 200 | **~2.1s** | **201** | **400** |
| 3 | 200 | **~4.9s** | **201** | **400** |

**Pika kryesore e detyrës (CI → cloud ≤10s):** **PO** ×3 (Supabase `hotel_guests` `checked_in` + QR 201 brenda ~2–5s).

Supabase `hotel_guests`: `AUDIT-PUSH-R*` **`checked_in`** para pastimit. **Pastrim:** CO + clean lokale, `DELETE hotel_guests` audit, dhoma **102–104** → `free` në cloud.

---

## 2026-10-10 — AUDIT recepsion i plotë (3×, kopje DB :3995) — **pa ndryshime kodi produkti**

**Metodë:** `%TEMP%\hotel-e2e-audit-20261010\hotel.db`, server **3995**, `AUDIT_SET_TEMP_ADMIN=1` vetëm në kopje. Skript: `tmp-hotel-e2e-recepsion-full.js`. Rezultat: `%TEMP%\hotel-recepsion-audit.json`. Cloud lexim/pastrim: Supabase `revolution-hotel` (klient `te-naseri-2-aed709`).

**Përgatitje kopje:** 39 dhoma `free` (nuk u bë check-out shtesë). Prova: dhoma **102 / 103 / 104**, netë **1 / 2 / 3**, totale CO **45 / 136.5 / 288 €**.

### Tabela hapat (×3 — e njëjta rend)

| Hapi | Pritje | Rezultat (përmbledhje 3×) | PO/JO | Skedar + rresht |
|------|--------|---------------------------|-------|-----------------|
| Rezervim | 201, `display_status=reserved` | **201**, `disp=reserved` | **PO** | `database.js` ~5285–5338, ~3084–3089 |
| Check-in nga rezervimi | occupied + mysafir aktiv | **200**, `st=occupied` | **PO** | `server.js` ~4438–4445 |
| Cloud `hotel_guests` **menjëherë** (6s, pa sync manual) | mysafir `checked_in` te-naseri-2 | **Jo** në 6s; pas `sync-all` në CO: rreshta `AUDIT-REC-*` (pastaj **fshi** nga audit) | **JO** | `server.js` ~4438 (**nuk** thërret `pushHotelGuestStayToCloudAsync`; krahaso ~3897) |
| Restorant «në dhomë» (`charge-to-room`) | 200; **cash** ndërrimi kamarier **0** | **200**, cash **0→0** (room_shift rritet) | **PO** | `server.js` ~4452–4505 |
| QR dhomë cloud → pranim | 201 + accept → folio | **404** (URL audit i gabuar) + mysafir **mungon** në cloud gjatë qëndrimit | **JO** | Skript audit; API: `guest.js` ~126 `/hotel/api/guest/menu-order?slug=&key=` |
| Shërbim (saunë/spa) | në faturë | **201**, `hasLine=true` (3×) | **PO** * | `server.js` ~4247–4261 (201, jo 200) |
| Fatura para CO | netë + charges | room+charges → total_due **45 / 136.5 / 288** | **PO** | `database.js` ~3939–3972 |
| Check-out recepsion (mixed cash/card) | 200, `dirty` | **200**, `st=dirty` | **PO** | `server.js` ~3922–3989 |
| Cloud pastrim (pas CO + `POST /api/cloud-sync/sync-all`) | dirty në cloud | **PO** — `hotel_rooms` 102–104 `dirty`; `hotel_housekeeping` me `dirty` | **PO** | `hotel-cloud-sync.js` ~497–506; `server.js` ~3979 |
| Raport ditor | total pa dyfishim, sipas burimit | `totalSales` **147→616.5**; `reception_collected` room **390** / rest **31.5** / svc **48**; `hotelNights` **60→60** (i fiksuar nga raporti i vjetër) | **Pjesërisht** | `database.js` ~8502–8524 |
| Mbyllje ndërrim recepsion | cash/card = CO | **200** (p.sh. cash **22.5** + card **22.5** run 1) | **PO** | `database.js` ~8848–8867 |

\* Shërbimi: skripti audit shënoi **JO** sepse priste HTTP **200**; API kthen **201** — funksionalisht **PO**.

### Gabime / mangësi (lista — **mos u rregullua** në këtë detyrë)

| # | Çfarë | Skedar + rresht |
|---|--------|-----------------|
| 1 | Check-in **nga rezervimi** nuk dërgon snapshot mysafiri në cloud menjëherë (QR cloud kërkon `hotel_guests` aktiv) | `server.js` ~4438–4445 (mungon `pushHotelGuestStayToCloudAsync` si ~3897) |
| 2 | QR dhomë **nuk u provua** end-to-end: URL e gabuar në skript audit (`/api/guest/{slug}/menu-order` → **404**); endpoint i saktë `POST /hotel/api/guest/menu-order?slug=…&key=…` | `tmp-hotel-e2e-recepsion-full.js`; `revolution-hotel-server/src/routes/guest.js` ~126 |
| 3 | Porosi QR gjatë qëndrimit do të dështojnë pa (1) — `guestHotelService.findActiveGuestForRoom` | `guestHotelService.js` ~150–169 |
| 4 | Raport: `hotelServices` mbetet **0** ndërsa `reception_collected.services` **48** — mundësi mospërputhje etiketash departamenti në UI raport | `database.js` ~8502–8524, `aggregateReceptionCollected` |
| 5 | `hotelNights` në raport ditor **nuk** u rrit me CO të reja (60→60) — netët e CO të auditit duken te `reception_collected.room`, jo te `hotelNights` | `database.js` ~8521–8524 |

**Pastrim cloud:** `DELETE` `hotel_guests` për `AUDIT-REC-%` (0 mbetën). Pa porosi QR cloud (404). Dhoma **102–104** mbeten `dirty` në cloud/lokal (e pritshme pas audit).

**Verifikim:** `node tmp-hotel-e2e-recepsion-full.js` + SQL Supabase për `hotel_guests` / `hotel_rooms` / `hotel_housekeeping`.

---

## 2026-10-10 — Sync staf pastrim (`pos_staff_role_check`) — **fix në cloud server**

Shkaku dhe ndryshimet: **`revolution-hotel-server/PUNA.md`** (087 + `posSyncService.js`). Desktop **`cloud-sync.js` ~1147–1153** tashmë dërgon `role: housekeeping` — **pa ndryshim** këtu. Pas deploy cloud: sync catalog nga PC.

---

## 2026-10-10 — Porosi cloud kamarier (400 në audit) — **gabim skripti, jo programi**

### Shkaku

| Burim | Payload |
|-------|---------|
| **`tmp-hotel-e2e-cloud-order.js`** (audit i vjetër) | `waiter_name: "AUDIT-Cloud"`, `table_number`, `items` (+ opsional `menu_item_id`) — **pa `waiter_id`**, **pa PIN/login** |
| **`waiter.js` i vërtetë** (`submitOrder`) | Pas PIN: `waiter_id` + `waiter_name` (`waiterPayload()` ~247–252), `table_number`, `items: { name, quantity, price }` — **jo** `menu_item_id` |

**Body i saktë i 400 në audit** (ripostuar me payload të skriptit): `{ "ok": false, "gabim": "Mungon ID e kamarierit." }` — nga `waiterPinService.resolveWaiterForOrder` ~299–302 (`revolution-hotel-server`).

Audit **nuk** e ruajti `gabim` në `audit-cloud.json` (vetëm `status=400 id=?`).

### Verifikim (3×) — payload si `waiter.js`

**Metodë:** `%TEMP%\hotel-e2e-audit-20261010\hotel.db`, server lokal **3995**, `POST …/login` (PIN kamarier) → `POST …/orders` me `waiter_id` + `waiter_name` + `items`. Pas çdo porosie: `POST /api/waiter/trigger-sync` → kontroll `GET /api/tables?layout=1` (`order.cloud_order_id`). Pastrim: `POST …/orders/cancel` (200×3).

| Run | Cloud | PC import (`cloud_order_id`) |
|-----|-------|------------------------------|
| 1 | **201** | **PO** |
| 2 | **201** | **PO** |
| 3 | **201** | **PO** |

**Ndryshime kodi produktit:** **asnjë** (400 ishte nga payload audit). **Jo** pending queue — WEB-WAITER importohet auto nga `online-orders-watcher.js` (~507–518), jo `online-orders/pending`.

**Helper:** `tmp-hotel-e2e-cloud-waiter-correct.js` (audit i ri, lexon `AUDIT_PREP_OUT` / `%TEMP%\hotel-audit-secrets.json`).

---

## 2026-10-10 — AUDIT E2E LOKAL (API reale, **pa Setup**, **pa ndryshime kodi produktit**)

**Metodë:** Kopje `hotel.db` → `%TEMP%\hotel-e2e-audit-20261010\` (jo DB origjinale në `%AppData%`). `node server.js` në **port 3995**, `DB_PATH` = kopja. ATK: `HOTEL_ATK_SEND_ALLOWED=0`, `FISCAL_LOCAL_RUN=1`. Për route **admin**: vetëm në kopje — `AUDIT_SET_TEMP_ADMIN=1` + `flushDatabase()` (fjalekalim i përkohshëm audit, **jo** klienti). `audit-secrets.json` **u fshi** pas testit. Skripta: `tmp-hotel-e2e-prep.js`, `tmp-hotel-e2e-audit-http.js`, `tmp-hotel-e2e-cloud-order.js` (helper audit — **jo** pjesë e Setup).

**Verifikim:** Server nisur → `http://127.0.0.1:3995` (log: v1.0.602). Rezultat JSON: `%TEMP%\hotel-e2e-audit-20261010\audit-results-v2.json`, `audit-cloud.json`.

### Tabela veprimesh (çka pritej → çka doli)

| # | Veprim | Pritje | Rezultat | PO/JO | Skedar + rresht | Rëndësi |
|---|--------|--------|----------|-------|-----------------|--------|
| 1 | PIN kamarier (×2) | token | `roli=kamarier` | **PO** | `server.js` ~2651 | — |
| 2 | PIN recepsion | token | `roli=recepsion` | **PO** | `server.js` ~2651 | — |
| 3 | PIN recepsion në panel kamarier | 401 | refuzuar | **PO** | `server.js` ~2665 | — |
| 4 | Hyrje pronari (API) | admin token | OK (vetëm pas temp admin në kopje) | **PO** * | `server.js` ~2399 | mesatar * |
| 5 | RFID | token/card | **Nuk u provua** (API `POST /api/login/card` — pa kartelë fizike) | **?** | `server.js` ~2750 | mesatar |
| 6 | Rol pastrim (PIN) | token | **Nuk u provua** — në kopje nuk ka staf `pastrim` | **?** | `login.html` / cloud `sherbimi` | mesatar |
| 7 | Tavolinë T2–T5: porosi + mbyllje cash/kartë/dhomë/mixed | close 200, stok ↓ | close **200**; ndërrimi **cash=12.75**; stok 7→2→0 (disa assert stok JO për baseline gabim në skript) | **Pjesërisht** | `server.js` ~4658 `closeTable` | mesatar |
| 8 | Ndërrim restorant hap/mbyll | cash ≠ room | cash **12.75**, room **0**, close 200 | **PO** | `database.js` `computeShiftTotals` | — |
| 9 | Ndërrim recepsion hap/mbyll | 200 | close 200 | **PO** | `server.js` ~3349 | — |
| 10 | Blerje +7 copë | stok +7 | pur **200**, stok **0→7** | **PO** | `server.js` ~6728, `createPurchaseInvoice` | — |
| 11 | Rezervim→check-in→shërbim→check-out | CO 200, dirty | res **400**, CI/CO **400** (kopja: **40/40 dhoma occupied**, mysafirë realë) | **JO** | `server.js` ~4408–3922 | **i rëndë** (datë/test) |
| 12 | Pastrim start/complete (API) | 200 | start **200**, complete **200** | **PO** | `server.js` ~4083–4094 | — |
| 13 | B2B faturë + pagesë 40€ / borxh 60€ | endpoint pagese | inv **201**, `POST .../payments` → **404** | **JO** | `sales-invoices-routes.js` (~81, **mungon route**) | **i rëndë** |
| 14 | Raport ditor | total = shitje | GET **200** (`totalSales` në body, jo `totals.sales`) | **PO** | `database.js` ~8502 `getReports` | i vogël |
| 15 | Kontabilitet TVSH | 200 | **200** | **PO** | `server.js` ~6291 | — |
| 16 | Cloud bootstrap te-naseri-2 | ok | **200** `ok:true` | **PO** | `revolution-hotel-server` `waiter.js` ~87 | — |
| 17 | PC `trigger-sync` + pending | 200 | sync **200**, pending **200** | **PO** | `cloud-sync.js` | — |
| 18 | Cloud POST porosi tavolinë (telefon) | 201 → PC import | audit: **400** (payload pa `waiter_id`); **riprovë 2026-10-10: 201 + import PO ×3** | **PO** * | skript audit vs `waiter.js` ~2190–2197 | **i rëndë** * |
| 19 | Pastrim cloud porosi test | cancel OK | **Nuk u arrit** (pa order id) | **JO** | `waiter.js` ~71 | mesatar |
| 20 | Sync catalog cloud | OK | log: `pos_staff_role_check` (**housekeeping**?) | **JO** | cloud `posSyncService` / Supabase | **i rëndë** |
| 21 | Porosi QR dhomë / venue + 15 min | E2E | **Nuk u provua** (pa POST cloud me QR payload) | **?** | `online-orders-watcher.js` ~18 | **i rëndë** |
| 22 | Print kupon | 1× thirrje | close/CO me `fiscal_skip` + thermal — log `[printer] spooler OK` gjatë ndërrimit | **Pjesërisht** | `close-table-print.js` | mesatar |

\* **Hyrja pronari në DB me `kitchen_key`:** cloud sync mund ta mbishkruajë fjalëkalimin e adminit nga cloud; në kopje u hoq `kitchen_key` + temp admin vetëm për audit API.

### Gabimet — sipas rëndësisë

1. **i rëndë — B2B pagesë e pjesshme / borxh:** nuk ka `POST /api/admin/sales-invoices/:id/payments` → **404** (`sales-invoices-routes.js`).
2. ~~**i rëndë — Porosi cloud nga telefoni**~~ → **zëvendësuar:** audit dërgoi payload **pa `waiter_id`** (`gabim`: «Mungon ID e kamarierit.»); me login + payload si `waiter.js` → **201** + import PC (**PO** ×3). Pending queue **nuk** është kriteri i saktë për WEB-WAITER.
3. **i rëndë — Sync staf → cloud:** `pos_staff_role_check` (rol `housekeeping` / pastrim) gjatë `catalog/sync` (log server audit).
4. **i rëndë — Flow i plotë recepsion** në kopjen aktuale: **nuk ka dhoma free** → rezervim/check-in **400** (duhet kopje me dhomë lirë ose check-out test).
5. **mesatar — RFID, PIN pastrim, QR 15 min E2E:** nuk u mbuluan në këtë sesion.
6. **mesatar — Admin login** me instalim real (celesi + cloud) pa fjalëkalim lokal të njohur.
7. **i vogël — Raport UI/API:** fusha totale `totalSales` / `restaurantSales`, jo `totals.sales`.

**Pastrim:** `audit-secrets.json` fshi; cloud porosi test **nuk** u krijua me sukses → asgjë për cancel në Supabase. Kopja `%TEMP%` mbetet lokale (mund të fshihet manualisht).

---

## 2026-10-10 — KONTROLL I PLOTË PARA SETUP-IT (audit — **pa ndryshime kodi**)

**Metodë:** Lexim `.cursorrules` + `CLAUDE.md`; prova vetëm në **DB të përkohshme** (`tests/*` — jo DB klienti); cloud **vetëm lexim** te klienti **`te-naseri-2`** / slug canonical `te-naseri-2-aed709`; **asnjë** POST/PUT që modifikon të dhëna cloud; **asnjë** dërgim ATK; **jo** Electron/Setup UI në këtë sesion; **jo** build/push.

**Pastrim testesh cloud:** Nuk u krijuan të dhëna test në Supabase/cloud gjatë auditit → **nuk kishte çfarë të fshihej**.

**Verifikim automatik (×4):** `node tests/run-all.js` → **5/5 suite** çdo herë (përfshirë `protected-functions` 10/10, B2B 5/5, blerje 12/12, factory-reset 5/5, kontabilist-atk suite).

**Live cloud:** `GET /hotel/health` → 200, `git_commit` ≈ `a44a163…`; `GET /hotel/api/r/te-naseri-2` → 200 (dhoma, menu, shërbime).

**Rrezik Setup:** Working tree desktop **shumë i modifikuar** vs `origin/master` (20+ skedarë) — Setup i vjetër **nuk** përmban këto ndryshime derisa të bëhet build i ri me OK.

### Tabela e kontrollit

| # | Zona | Provuar sa herë | Punon? | Gabimi (nëse ka) | Skedari + rreshti | Sa i rëndë |
|---|------|-----------------|--------|------------------|-------------------|------------|
| 1 | Hyrja / rolet (PIN, RFID, pronari vs staf) | 0 UI; 1 lexim kod | **?** | Nuk u hap `login.html` në Electron; RFID/PIN redirect te role — vetëm kod | `public/login.html` ~138–229 | **i rëndë** (pa provë UI) |
| 2 | Izolimi roleve (çdo rol sheh vetëm të vetin) | 0 UI; 1 grep | **?** | Nuk u testua me 4 PIN të ndryshëm në app | `server.js` middleware staf; `public/waiter.html` vs recepsion | **i rëndë** |
| 3 | Restorant: tavolinë, porosi, shto/hiq, ndarje, pagesë cash/kartë/dhomë | 4× suite DB | **Pjesërisht** | Logjikë mbylljeje/stok/pagese në test; **jo** UI tavolinash, **jo** ndarje fature vizuale | `tests/protected-functions.test.js`; `database.js` `closeTable` | **i rëndë** (UI) / **PO** (logjikë DB test) |
| 4 | Kuponi / print mbylljeje tavoline | 0 runtime; 1 trace | **?** | Thirrje `printReceiptAt` / `close-table-print` ekziston; **nuk** u simulua printer | `close-table-print.js` ~86; `server.js` ~5274 | **mesatar** |
| 5 | Arka / ndërrime restorant vs recepsion; cash = cash real; «Në dhomë» veç | 4× | **PO** (logjikë) | Test: 10€ cash + 5€ room → `cash_total` 10, `room_total` 5; check-out 50€ → raport +60 pa dyfishim `(T#)` | `protected-functions.test.js` ~348–435; `database.js` `computeShiftTotals` | **PO** në DB test; **?** UI ndërrimi |
| 6 | Recepsion: rezervim, check-in, ngarkesa, check-out, fatura mysafiri | 0 UI; 1 kod | **?** | Sync PMS / folio në kod; **nuk** u ekzekutua flow recepsion | `hotel-cloud-sync.js`; `database.js` folio | **i rëndë** |
| 7 | Dhomat / pastrimi: statuse, check-out → për pastrim | 0 UI; 1 kod + cloud GET | **Pjesërisht** | Cloud `/hotel/te-naseri-2/sherbimi` → **200** (redirect nga `-aed709`); push HK në kod desktop | `server.js` HK API; `sherbimi-cloud.html` (cloud) | **mesatar** (UI pastrimi pa PIN live) |
| 8 | Shitje → stoku | 4× | **PO** | `decrementMenuItemStock` pas `closeTable`; cloud rebuild pa dyfishim | `protected-functions.test.js` ~400–419 | **i vogël** (mbuluar test) |
| 9 | Blerje → stoku + kosto | 4× | **PO** | `increaseMenuItemStock`; neto/bruto skanim | `purchase-neto-bruto.test.js`; test rritje stoku | **i vogël** |
| 10 | Inventari = shitje + blerje | 0 UI; 1 test indirekt | **?** | Nuk u numërua inventar fizik vs sistem në UI | `database.js` reconcile baseline në test boot | **mesatar** |
| 11 | Kontabiliteti: shitje, blerje, TVSH, raporte | 4× | **PO** (logjikë) | B2B ledger + ATK book test; **jo** tab Admin kontabilist | `hotel-b2b-kontabilist.test.js` | **mesatar** (UI) |
| 12 | B2B: fatura, pagesa, borxhe | 4× | **PO** (logjikë) | `listFinalizedHotelSalesForKont`, TVSH buckets | `hotel-b2b-kontabilist.test.js` | **mesatar** (UI B2B) |
| 13 | Raporte ditore / departament (pa dyfishim) | 4× | **PO** (logjikë) | `getReports` / `splitCheckoutReceptionEntry` në test room+cash+CO | `protected-functions.test.js` ~435 | **mesatar** (UI raporte) |
| 14 | QR: dhomë, tavolinë, venue; skadim 15 min | 0 E2E; 1 kod | **Pjesërisht** | `UNTOUCHED_PENDING_EXPIRE_MS` = 15 min desktop; cloud `pendingAcceptExpiry.js` 15 min; **jo** porosi reale QR | `online-orders-watcher.js` ~18; `pendingAcceptExpiry.js` ~12 | **i rëndë** (E2E) |
| 15 | PC ↔ cloud (tavolina, porosi, pagesa, HK, mysafirë) | 0 sinkron live | **?** | Watcher/sync në kod; **nuk** u bë veprim dy-krahësh PC+telefon | `cloud-sync.js`; `online-orders-watcher.js` | **i rëndë** |
| 16 | Panel pronari (cloud): tab + të dhëna | 0 login owner | **?** | Faqet publike/staff **GET** OK; panel kërkon session — **nuk** u hapur | `revolution-hotel-server/public/js/owner.js` | **i rëndë** |
| 17 | Linqet Internet + Wi‑Fi (kamarier, recepsion, pastrim) | 3× curl | **Pjesërisht** | `/hotel/te-naseri-2/kamarier` **200**; `/recepsion` **200**; `/sherbimi` **200**; Wi‑Fi varet nga sync PC (`staff_local_links`) — **nuk** u verifikua payload live | `local-staff-links.js`; cloud `owner.js` | **mesatar** |
| 18 | Fiskalizimi: gati, pa ATK, kupon jo dy herë | 0 runtime; 1 kod | **Pjesërisht** | `FISCAL_LOCAL_RUN=1`, `ATK_AUTO_SEND=0` në `main.js`/`server.js`; dedup print `<5s` MD5 | `fiscal-main.js` ~369–376; `fiscal-local-env.js` | **mesatar** (licencë + printer) |
| 19 | Cloud health / migrim 086 `expired` | 1 API + Supabase (sesion prior) | **PO** | `sales_orders.status` përfshin `expired` | `086_hotel_order_expired_status.sql` | **i vogël** |
| 20 | URL e gabuar `/hotel/.../waiter` | 1 curl | **JO** (404) | Rruga e saktë publike: `/hotel/{slug}/kamarier` ose gateway — **jo** `/waiter` nën `/hotel` | `revolution-hotel-server/src/server.js` ~812 | **i vogël** (dokumentim/link) |

### Gabimet / boshllëqet — sipas rëndësisë

1. **i rëndë — Nuk u verifikua UI/Electron (Setup aktual):** Hyrje PIN/RFID, restorant, recepsion, admin, print fizik — vetëm teste DB + lexim kod. **Hapi tjetër:** Setup i ri + prova manuale 3–4× për zonë.
2. **i rëndë — PC ↔ cloud E2E:** Nuk u testua që veprim në PC shfaqet në telefon/pronari dhe anasjelltas (porosi, pagesa, HK).
3. **i rëndë — QR 15 min + routing porosish:** Konstantet 15 min në kod; **nuk** u krijua porosi test (me qëllim — pa ndryshuar cloud).
4. **i rëndë — Working tree desktop ≠ Setup i instaluar:** Shumë ndryshime lokale të padërguara; Setup i vjetër nuk reflekton fix-et e fundit.
5. **mesatar — Print/kupon:** Vetëm trace kod; printer ESC/POS nuk u thirr.
6. **mesatar — Panel pronari + numra KPI:** Kërkon login owner; tab-et nuk u klikuan.
7. **mesatar — Inventar UI vs lëvizje stoku:** Vetëm stok nga teste automatike.
8. **mesatar — Fiskalizimi runtime:** Dedup 5s; pa licencë ATK — sjellja e plotë e kuponit nuk u provua.
9. **i vogël — `/hotel/{slug}/waiter` → 404:** Përdor `/kamarier` (live 200 për `te-naseri-2`).

**Kufizim i auditit:** Me OK të Naserit, rregullimet **një nga një** — **mos** u prek asgjë gjatë këtij raporti.

---

## 2026-10-10 — Auto-push staff_local_links kur ndryshon IP LAN (server)

### Qëllimi
Kur adresa Wi‑Fi/LAN e PC-së ndryshon, programi dërgon **vetë** `staff_local_links` te cloud (panel pronari) — **pa** «Përditëso të dhënat». Dërgohet **vetëm** kur fingerprint ndryshon, jo çdo poll.

### Ndryshime
| Skedar | Ndryshim |
|--------|----------|
| `local-staff-links.js` | `staffLocalLinksFingerprint`, ruajtje `staff_local_links_cloud_fp`; `startStaffLocalLinksLanWatcher` (15s, vetëm në ndryshim) |
| `cloud-sync.js` | `pushStaffLocalLinksAsync` → `POST /api/v1/pos/catalog/sync` me vetëm `staff_local_links`; fingerprint pas `pushCatalogAsync` |
| `server.js` | `onServerListening` → nis watcher (funksionon edhe pa Admin të hapur) |

### Verifikim (dev)
- Ndrysho IP (ose mock `pickLanIPv4Address`) → log `[cloud] staff_local_links u dërgua` një herë; intervali i radhës pa POST nëse IP e njëjtë.

### Setup
- **Setup.exe** desktop. **Jo** deploy cloud (endpoint ekzistues). Jo build/push.

---

## 2026-10-10 — KTHIM: Wi‑Fi në Admin + modal stafi (undo «hiq Wi‑Fi»)

| Skedar | Kthim |
|--------|--------|
| `public/admin.html` | `#cloud-row-local-waiter` (+ QR print), recepsion, **pastrim** Wi‑Fi; `vendosLinketCloud` + `startLocalWaiterLanPoll`; modal stafi Wi‑Fi «Gjenero link» |

LAN/IP: `local-staff-links.js` + sync cloud — **pa shkrim manual IP**; QR/hint «përditësohet kur ndryshon rrjeti».

**Setup.exe** + **deploy cloud** (panel pronari). Jo build/push.

---

## 2026-10-10 — WiFi pastrim + linke sync (panel pronari)

### Ndryshime
| Skedar | Ndryshim |
|--------|----------|
| `local-staff-links.js` | URL LAN `/hotel/{slug}/sherbimi` në payload sync |
| `server.js` | `getLocalSherbimiUrl`, rrugë LAN → redirect cloud pastrim; `local_staff_wifi.sherbimi` |
| `public/admin.html` | Rresht «Pastrim — WiFi i hotelit»; etiketë pastrim internet |

### Setup
- **Setup.exe** — pastaj «Përditëso të dhënat» cloud që pronari të shohë WiFi pastrimi.

---

## 2026-10-10 — Sync pastrimi ↔ cloud (telefon `/sherbimi`)

### Ndryshime
| Skedar | Ndryshim |
|--------|----------|
| `hotel-cloud-sync.js` | Check-in/out snapshot dërgon edhe **housekeeping**; pull nga cloud përditëson **status dhome** nga task |
| `cloud-sync.js` | Roli staf `pastrim` / `housekeeping` → `pos_staff.role = housekeeping` në cloud |
| `server.js` | Pas çdo veprimi `/api/waiter/housekeeping/*` → `pushHousekeepingToCloud` + `pushRoomsToCloud` |

### Setup / Deploy
- **Setup.exe** desktop (push/pull pastrimi).
- **Deploy** `revolution-hotel-server` për faqen `sherbimi-cloud`.

### Git / build
- **Jo** commit, **jo** push, **jo** build.

---

## 2026-10-10 — Llogari restorant ↔ recepsion («Në dhomë»)

### Ndryshime
| Skedar | Ndryshim |
|--------|----------|
| `database.js` | `normalizePaymentMethod` / `paymentMethodLabel` → `room` = «Në dhomë»; `computeShiftTotals` → `room_total`, cash vetëm cash real; `splitCheckoutReceptionEntry` / `getReports` / `getDitari` → pa dyfishim ushqim `(T#)` në total; `byRegister` ndarje dhoma/restorant/shërbime |
| `public/waiter.html` | Mbyllje ndërrimi + ekrani «done»: Cash / Kartë / Në dhomë |
| `waiter-shift-html.js`, `shift-report-html.js` | Kupon X/Z/mbyllje: rresht «Në dhomë» |
| `shift-close-email.js` | Payload cloud: `room_total` |
| `tests/protected-functions.test.js` | Test: 10€ cash + 5€ room → arka 10€; check-out 50€ → total +60€ |

### Verifikim
- `node tests/protected-functions.test.js` → **10 passed, 0 failed** (shembull 10+5 / CO 50 → total +60).

### Setup
- **Setup.exe HOTEL desktop** — mbyll programin plotësisht, hape përsëri.

### Git / build
- **Jo** commit, **jo** push, **jo** build.

---

## 2026-10-10 — Skadim 15 min porosi pa PRANO (sinkron cloud)

### Ndryshime
| Skedar | Ndryshim |
|--------|----------|
| `online-orders-watcher.js` | `UNTOUCHED_PENDING_EXPIRE_MS` **60s → 15 min**; recepsion QR dhomë/shërbim **nuk** përjashtohen më nga skadimi lokal; `removeRoomChargesForExpiredCloudOrder` kur hiqet nga alarmi |
| `database.js` | `removeRoomChargesForExpiredCloudOrder`, `parseFolioChargeIdsFromCloudPayload` — fshin `room_charges` lokale sipas `folio_charge_local_ids` nga payload cloud |

### Varësi
- Cloud duhet të vendosë `status = expired` dhe `folio_charge_local_ids` në porosi (`revolution-hotel-server` — shih `PUNA.md` atje).

### Setup
- **Setup.exe HOTEL desktop** pas ndryshimeve — jo vetëm deploy cloud.

### Git / build
- **Jo** commit, **jo** push, **jo** build.

---

## 2026-10-16 — Online 1–6 auto-mbyllje + sync mbyllje POS→telefon

### Shkaku
- `syncLocalCancelledFromCloud`: `cloudOrderedIds` jo i plotë për online → `finalizeLocalTableAfterCloudSaleClose` gabim.
- `clearStuckCloudTableOrder` mund të prekte zone Online.

### Fix
- `cloud-sync.js`: mbrojtje Online/takeaway + `collectActiveCloudOrderIdsForSync`; `await pushTableFree`.
- `server.js`: `await pushTableFree` pas mbylljes lokale.
- `revolution-hotel-server` `salesService.js`: SSE pas mbylljes POS tavolinë fizike.

### Provë
- `node tests/protected-functions.test.js` → 15 passed.
