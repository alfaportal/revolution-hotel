# FISCAL-REQUIREMENTS.md — KËRKESAT FISKALE PËR KAFENE (SEF)

## ⛔ RREGULLA ABSOLUTE — LEXO PARA SE TË BËSH ÇDOGJË

1. **ASNJËHERË mos prek funksionet ekzistuese** — closeTable, cloud-sync, printer, waiter panel, QR porosi, tavolinat, shiftet. Lexo PROTECTED-FUNCTIONS.md.
2. **ASNJËHERË mos ndrysho kolonat ekzistuese** në SQLite — vetëm SHTO kolona/tabela të reja.
3. **ASNJËHERË mos fshi kod ekzistues** — vetëm shto kod të ri.
4. **Çdo skedar i ri** duhet me u shtu në `build.files` te `KAFENE/package.json` DHE në `scripts/obfuscate-build.mjs`.
5. **Testo pas çdo ndryshimi** — `npm run build` + instalo nga `dist/`.
6. **Moduli fiskal ndezet/fiket me toggle** — kur FISCAL_ENABLED=false, KAFENE punon SAKTËSISHT si para. BABYLON nuk guxon me e ndi asnjë ndryshim.
7. **Krejt ndryshimet fiskale shkojnë në module të veçanta** — mos i përzje me kodin ekzistues.

---

## BAZA LIGJORE

- Udhëzim Administrativ (MF) Nr. 01/2026 (52 nene)
- Ligji Nr. 08/L-257 për Administrimin e Procedurave Tatimore
- Kërkesat Specifike Teknike dhe Funksionale për PEF/SF/SEF (88 faqe)
- Kushtet dhe Procedurat për Aplikimin, Certifikimin dhe Mirëmbajtjen e SEF
- Ndryshim-plotësimi i Dokumentit Nr. 01-06-1967 (22/06/2026)
- Udhëzues i Përdorimit të Sistemit për Testim dhe Aplikim për Certifikim të SEF

---

## ARKITEKTURA E MODULIT FISKAL

```
Skedarët e rinj (krejt në KAFENE/):
├── fiscal/
│   ├── fiscal-config.js      — toggle, settings, konstantet
│   ├── fiscal-receipt.js      — gjenerimi i kuponit fiskal
│   ├── fiscal-numbering.js    — NUIKF + numri ditor
│   ├── fiscal-vat.js          — normat A/C/D/E, kalkulimet
│   ├── fiscal-qr.js           — QR kod me nënshkrim digjital
│   ├── fiscal-offline.js      — queue offline, write-once, dërgim automatik
│   ├── fiscal-correction.js   — kuponë korrigjues/storno/anulim
│   ├── fiscal-audit.js        — audit log write-once, eksport CSV/PDF
│   ├── fiscal-atk-api.js      — integrimi me SIATK (HTTPS)
│   ├── fiscal-crypto.js       — certifikata digjitale, çelësi privat, nënshkrimi
│   ├── fiscal-print.js        — formatimi i kuponit fiskal për printer termik
│   ├── fiscal-logo.js         — logo RKS/MF (min 15x8mm, max 20x10mm)
│   └── fiscal-i18n.js         — shumëgjuhësia (shqip + serbisht)
```

**PARIMI:** Çdo skedar punon i pavarur. Nëse fiscal-config.js thotë FISCAL_ENABLED=false, asnjë modul tjetër fiskal nuk aktivizohet.

---

## HAPI 1 — DATABAZA (SQLite)

### Tabela e re: `fiscal_receipts` (WRITE-ONCE — nuk lejohet UPDATE/DELETE)
```sql
CREATE TABLE IF NOT EXISTS fiscal_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,                    -- lidhje me sales_orders.id
  nuikf TEXT NOT NULL UNIQUE,                  -- Numri Unik Identifikues, max 16 char alfanumerik
  sef_id TEXT NOT NULL,                        -- Nr. Identifikues SEF: [NUI]-[NUI]-[PosId]
  receipt_type TEXT NOT NULL DEFAULT 'regular', -- 'regular', 'cancel', 'return', 'storno'
  original_nuikf TEXT,                         -- për kuponë korrigjues — referencë te origjinali
  daily_number INTEGER NOT NULL,               -- numri ditor, resetohet pas raportit Z
  fiscal_date TEXT NOT NULL,                   -- data e lëshimit
  fiscal_time TEXT NOT NULL,                   -- ora:minutat e lëshimit
  operator_name TEXT NOT NULL,                 -- emri i kamarierit/operatorit
  operator_id TEXT NOT NULL,                   -- numri identifikues i operatorit
  taxpayer_nui TEXT NOT NULL,                  -- NUI/NF i tatimpaguesit (klientit/biznesit)
  taxpayer_vat TEXT,                           -- Nr. TVSH (nëse ka)
  taxpayer_name TEXT NOT NULL,                 -- emri ligjor
  taxpayer_address TEXT NOT NULL,              -- adresa
  items_json TEXT NOT NULL,                    -- JSON: [{name, qty, unit_price_2dec, total_2dec, vat_norm}]
  subtotal REAL NOT NULL,                      -- nën-totali
  discount_amount REAL DEFAULT 0,              -- zbritja (nëse ka)
  total_amount REAL NOT NULL,                  -- shuma totale për pagesë
  total_without_tax REAL NOT NULL,             -- shuma totale PA tatim
  vat_breakdown_json TEXT NOT NULL,            -- JSON: {A: 0, C: 0, D: amount_8, E: amount_18}
  payment_method TEXT NOT NULL,                -- 'cash','debit_card','credit_card','bank_account','voucher','check','sms'
  currency TEXT NOT NULL DEFAULT 'EUR',        -- gjithmonë EUR
  qr_code_data TEXT NOT NULL,                  -- QR me nënshkrim digjital (jo QR i thjeshtë)
  digital_signature TEXT,                      -- nënshkrimi elektronik i kuponit
  is_offline INTEGER DEFAULT 0,               -- 1 = lëshuar pa internet
  sent_to_atk INTEGER DEFAULT 0,              -- 0 = ende pa dërgu, 1 = dërgu me sukses
  atk_response_json TEXT,                      -- përgjigja nga SIATK
  sent_at TEXT,                                -- kur u dërgu te ATK
  created_at TEXT DEFAULT (datetime('now','localtime')),
  -- WRITE-ONCE: Kjo tabelë NUK lejon UPDATE ose DELETE. Vetëm INSERT.
  -- Kuponi korrigjues krijon rresht të ri me receipt_type='cancel'/'return'/'storno' + original_nuikf
  FOREIGN KEY (sale_id) REFERENCES sales_orders(id)
);
```

### Tabela e re: `fiscal_settings`
```sql
CREATE TABLE IF NOT EXISTS fiscal_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  fiscal_enabled INTEGER DEFAULT 0,            -- 0=OFF (si tash), 1=ON (kuponi fiskal aktiv)
  taxpayer_nui TEXT,                           -- NUI i biznesit (9 shifra)
  taxpayer_nf TEXT,                            -- Numri Fiskal
  taxpayer_vat_number TEXT,                    -- Nr. TVSH
  taxpayer_legal_name TEXT,                    -- emri ligjor i biznesit
  taxpayer_address TEXT,                       -- adresa e biznesit
  business_unit_number TEXT,                   -- Nr. Njësisë (POS-it) — unik për çdo pikë shitjeje
  pos_id TEXT,                                 -- Nr. i POS-it
  fiscalization_number TEXT,                   -- merret nga SIATK gjatë regjistrimit
  sef_code TEXT,                               -- kodi i zgjidhjes softuerike (merret pas certifikimit)
  developer_nui TEXT DEFAULT '811314567',       -- NUI i zhvilluesit (Revolution Invest)
  sef_identifier TEXT,                         -- format: [NUI]-[NUI]-[PosId]
  certificate_path TEXT,                       -- shtegu i certifikatës digjitale
  private_key_path TEXT,                       -- shtegu i çelësit privat (enkriptuar)
  atk_api_url TEXT,                            -- URL e SIATK (merret nga ATK)
  daily_receipt_counter INTEGER DEFAULT 0,     -- numri ditor, resetohet me raport Z
  last_z_report_date TEXT,                     -- data e raportit Z të fundit
  language TEXT DEFAULT 'sq',                  -- 'sq' = shqip, 'sr' = serbisht
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### Tabela e re: `fiscal_audit_log` (WRITE-ONCE)
```sql
CREATE TABLE IF NOT EXISTS fiscal_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                        -- 'receipt_created','receipt_sent','z_report','setting_changed','error'
  details_json TEXT NOT NULL,                  -- JSON me detaje
  operator_name TEXT,
  operator_id TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
  -- WRITE-ONCE: NUK lejohet UPDATE ose DELETE. Vetëm INSERT.
);
```

### Kolonat e reja në `sales_orders` (SHTO — mos prek ekzistueset):
```sql
ALTER TABLE sales_orders ADD COLUMN payment_method TEXT DEFAULT 'cash';
ALTER TABLE sales_orders ADD COLUMN fiscal_receipt_id INTEGER;
ALTER TABLE sales_orders ADD COLUMN is_fiscalized INTEGER DEFAULT 0;
```

---

## HAPI 2 — FISCAL SETTINGS (fiscal-config.js)

Në Admin → Settings, shtohet seksioni "Fiskalizimi" me fushat:
- Toggle: FISCAL_ENABLED (on/off)
- NUI (9 shifra)
- Numri Fiskal
- Nr. TVSH
- Emri ligjor i biznesit
- Adresa
- Nr. Njësisë
- Nr. POS-it
- Nr. Fiskalizimit (readonly — merret nga ATK)
- Kodi SEF (readonly — merret pas certifikimit)
- Gjuha (Shqip / Serbisht)

**RREGULL:** Kur FISCAL_ENABLED=false, asgjë fiskale nuk aktivizohet. KAFENE punon si deri tash.

---

## HAPI 3 — NORMAT TVSH (fiscal-vat.js)

Normat me shkronja (jo vetëm përqindje):
- **A** = përjashtuar nga TVSH (0%)
- **B** = rezervuar (nëse nevojitet)
- **C** = normë tjetër (përcaktohet nga ATK)
- **D** = 8% TVSH
- **E** = 18% TVSH

Çdo produkt në menu ka normën si shkronjë: A, B, C, D, ose E.
Kuponi tregon breakdown-in: sa ka normë A, sa D, sa E — veç e veç.
**Çmimi për njësi: 2 presje dhjetore** (p.sh. 1.50€) — si kuponi origjinal ATK.
**Totali: 2 presje dhjetore** (p.sh. 1.50€).
**Valuta: gjithmonë EUR.**

---

## HAPI 4 — MËNYRA E PAGESËS (sales_orders.payment_method)

7 mundësi:
- `cash` — para e gatshme (kesh)
- `debit_card` — debit kartelë
- `credit_card` — kredit kartelë
- `bank_account` — llogari bankare
- `voucher` — kupon shpërblyes (vauçer)
- `check` — çek
- `sms` — SMS pagesë

Kur mbyllet tavolina, operatori zgjedh mënyrën e pagesës para printimit.

---

## HAPI 5 — NUMRI DITOR + NUIKF (fiscal-numbering.js)

### Numri ditor:
- Fillon nga 1 çdo ditë
- Resetohet automatikisht pas raportit Z (mbyllja ditore)
- Ruhet në fiscal_settings.daily_receipt_counter

### NUIKF (Numri Unik Identifikues i Kuponit Fiskal):
- Max 16 karaktere alfanumerike
- Unik — nuk përsëritet kurrë
- Gjenerohet automatikisht nga softueri sipas formatit të ATK-së
- Ruhet në fiscal_receipts.nuikf

### Nr. Identifikues i SEF-it:
- Format: [NUI]-[NUI]-[PosId]
- P.sh.: 811314567-811314567-01
- Ruhet në fiscal_settings.sef_identifier

---

## HAPI 6 — KUPONI FISKAL (fiscal-print.js + fiscal-receipt.js)

Kuponi fiskal printohet në printer termik (58-100mm) sipas shembullit ATK:

```
[EMRI I BIZNESIT]              ← ESC E 1 (bold) + qendër, madhësi NORMALE (pa GS ! 0x11)
[Emri ligjor SH.P.K.]          ← qendër (nëse ndryshon nga brand)
[Adresa]                       ← qendër
[Qyteti]                       ← qendër

NR. FISKAL: [NUI]              ← qendër, bold
NR. TVSH: [TVSH]               ← qendër, bold

Operator: [Emri] (ID: [numri])
Data: [DD.MM.YYYY] Ora: [HH:MM]
----------------------------------------
Artikulli  Sasia  Çmimi   Vlera  TVSH
[emri]     [x]    [1.20]  [1.20] [E]     ← çmime me 2 presje
----------------------------------------
TOTALI NE EURO:                [4.50]    ← bold, madhësi normale
PARA TE GATSHME                [4.50]    ← bold, rresht i veçantë

TVSH D=8.00%:                  [0.30]    ← vetëm > 0; formati me =
TVSH E=18.00%:                 [0.69]
TOT. PA TVSH:                  [3.81]
----------------------------------------
NUIKF: [16 char alfanumerik]             ← bold
Nr. SEF: [NUI]-[NUI]-[PosId]
KUPON FISKAL NR. [numri ditor]           ← bold, qendër

[QR KOD IMAZH]
[LOGO RKS/MF IMAZH]
```

**ESC/POS:** ESC E 1 + ESC G 1 për krejt kuponin (bold); emri i biznesit madhësi NORMALE — pa GS ! 0x11.

**RREGULL:** Nëse receipt_type='cancel'/'return'/'storno', printohet edhe:
```
KUPON KORRIGJUES
Referencë: NUIKF [origjinali]
```

**RREGULL:** Nëse is_offline=1, printohet:
```
         *** OFFLINE ***
```

---

## HAPI 7 — KUPONËT KORRIGJUES (fiscal-correction.js)

- Kthim malli → receipt_type='return' + original_nuikf
- Anulim → receipt_type='cancel' + original_nuikf
- Storno → receipt_type='storno' + original_nuikf
- Kuponi korrigjues fiskalizohet njësoj si kuponi i rregullt
- NUIKF i ri gjenerohet për kuponin korrigjues
- Kuponi korrigjues printohet me referencë te NUIKF origjinal

---

## HAPI 8 — QR KODI (fiscal-qr.js + fiscal-crypto.js)

**QR kodi NUK është QR i thjeshtë** — përmban:
- Të dhëna të kuponit (NUIKF, shuma, data, NUI)
- Nënshkrim digjital (krijohet me çelësin privat)
- Lidhje direkte me SIATK për verifikim

Kur blerësi e skanon QR-në:
- Hapet lidhja me SIATK
- Shfaqet statusi: "Kuponi fiskal është regjistruar me sukses" ose gabimi

**Certifikata digjitale:**
- Gjenerohet nga ATK për çdo SEF/POS
- Ruhet në shteg të sigurt (fiscal_settings.certificate_path)
- Çelësi privat enkriptohet (fiscal_settings.private_key_path)

---

## HAPI 9 — OFFLINE MODE (fiscal-offline.js)

1. Kur s'ka internet → vazhdo me lëshu kuponë
2. Kuponi merr mbishkrimin "OFFLINE" (is_offline=1)
3. Ruhet në fiscal_receipts (write-once — NUK ndryshohet/fshihet)
4. Kur kthehet interneti → dërgohen automatikisht te SIATK
5. Brenda 48 orëve duhet me u dërgu
6. Nëse s'mundësohet brenda 48h → njoftim ATK
7. Nëse ndërprerja zgjat >1 muaj → paraqit kuponët deri ditën 10 muajit vijues

**Queue mekanizmi:**
- Çdo 60 sekonda kontrollo nëse ka kuponë me sent_to_atk=0
- Nëse ka internet → dërgo njëri pas tjetrit
- Pas dërgimit: sent_to_atk=1, sent_at=tash, atk_response_json=përgjigja

---

## HAPI 10 — AUDIT LOG (fiscal-audit.js)

- Çdo veprim fiskal regjistrohet në fiscal_audit_log
- **WRITE-ONCE** — nuk lejohet UPDATE/DELETE
- Eksportohet në CSV ose PDF vetëm me kërkesë (buton në Admin)
- Veprimet: receipt_created, receipt_sent, z_report, setting_changed, error, offline_start, offline_end

---

## HAPI 11 — SHUMËGJUHËSIA (fiscal-i18n.js)

- Minimum ligjor: **shqip + serbisht**
- Toggle në Settings: sq / sr
- Ndikon vetëm kuponi fiskal + interfejsin e SEF modulit
- Interfejsi ekzistues i KAFENE (menu, waiter, admin) mbetet në shqip si deri tash

---

## HAPI 12 — INTEGRIMI ME SIATK (fiscal-atk-api.js)

**Ky hap bëhet PAS testimit te ATK (Faza 1) kur merret API dokumentacioni.**

- Lidhje HTTPS me Sistemin Informativ të ATK-së
- Autentikim me certifikatë digjitale
- Dërgim i kuponit në kohë reale (JSON/Protobuf)
- Pranimi i përgjigjes + ruajtja
- Dokumentacioni teknik: GitHub - Fiskalizimi (repo: pos-csharp, pos-golang, pos-php, pos-ruby)

---

## HAPI 13 — VERIFIKIMI (fiscal-qr.js)

- QR kodi krijon lidhje direkte me SIATK
- Blerësi skanon → sheh statusin e kuponit
- Statuset: "regjistruar me sukses", "ka problem", "kupon korrigjues ekziston"

---

## RADHITJA E PUNËS (PRIORITETI)

```
HAPI 1  → Databaza (tabelat + kolonat e reja)
HAPI 2  → Settings fiskale (toggle + fushat)
HAPI 3  → Normat TVSH A/C/D/E
HAPI 4  → Mënyra e pagesës (7 lloje)
HAPI 5  → Numri ditor + NUIKF
HAPI 6  → Formatimi i kuponit fiskal
HAPI 7  → Kuponët korrigjues/storno
HAPI 8  → QR kod me nënshkrim (placeholder deri sa ATK jep certifikatën)
HAPI 9  → Offline mode i plotë
HAPI 10 → Audit logs
HAPI 11 → Shumëgjuhësia (shqip + serbisht)
HAPI 12 → Integrimi me API-në e ATK (kur ATK jep çasjen)
HAPI 13 → Verifikimi i kuponit (kur ATK jep çasjen)
```

---

## ⛔ RREGULLA PËR CURSOR — LEXO KREJT PARA SE TË FILLOSH

1. LEXO PROTECTED-FUNCTIONS.md para çdo ndryshimi
2. LEXO CLAUDE.md para çdo ndryshimi
3. LEXO .cursorrules para çdo ndryshimi
4. ASNJËHERË mos prek: closeTable, cloud-sync, printer ekzistues, waiter panel, QR porosi, SQLite sync
5. Çdo skedar i ri → shto në build.files + obfuscate-build.mjs
6. Çdo ndryshim → testo me `npm run build` + instalo
7. Kur FISCAL_ENABLED=false → KAFENE identike si para — ZERO ndryshime vizuale ose funksionale
8. Write-once tabelat (fiscal_receipts, fiscal_audit_log) → ASNJËHERË UPDATE/DELETE
9. Çmimi për njësi = 2 presje dhjetore (1.50), totali = 2 presje (1.50) — si ATK
10. Valuta = EUR gjithmonë
11. Printeri termik ekzistues përdoret — NUK shtohet harduer i ri
12. Krejt modulet fiskale shkojnë në folder-in `fiscal/` — mos i përzje me kodin ekzistues
13. Mos implemento ATK API (Hapi 12-13) pa pasë dokumentacionin zyrtar nga ATK
