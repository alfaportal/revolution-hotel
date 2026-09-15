-- Metoda e pagesës në sales_orders (kërkohet nga kamarieri/KDS/POS cloud sync)

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

COMMENT ON COLUMN sales_orders.payment_method IS 'cash ose karte — vendoset kur mbyllet tavolina';
