# Revolution HOTEL Server

Backend cloud për **Revolution HOTEL** — licenca, klientë, Super Admin.

Nuk përdor Supabase të POS dhe as të Security. Vetëm projekti HOTEL.

## Stack

- Node.js 20+ · Express
- Supabase: `https://mnzmbgaqtdxrtutfjesr.supabase.co`
- Deploy: Railway

## Setup

```bash
cp .env.example .env
# Vendos SUPABASE_SERVICE_ROLE_KEY (ose SUPABASE_KEY = anon) dhe JWT_SECRET
npm install
npm run dev
```

SQL (projekt bosh): `supabase/bootstrap_hotel.sql` në SQL Editor të Supabase HOTEL.

## Railway

| Variabël | Vlera |
|----------|--------|
| `PRODUCT_LINE` | `hotel` |
| `SUPABASE_URL` | `https://mnzmbgaqtdxrtutfjesr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API (jo POS, jo Security) |
| `JWT_SECRET` | string i gjatë random |
| `PUBLIC_APP_ORIGIN` | URL-ja e këtij Railway |

## API licence

`POST /api/v1/license/validate` — i njëjti kontratë si POS, por DB është HOTEL.
