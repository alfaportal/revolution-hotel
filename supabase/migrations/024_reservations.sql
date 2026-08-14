-- Rezervime tavolinash — owner panel + waiter app

CREATE TABLE IF NOT EXISTS reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  table_number    INTEGER NOT NULL CHECK (table_number >= 1 AND table_number <= 30),
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL DEFAULT '',
  date            DATE NOT NULL,
  time            TIME NOT NULL,
  guests          INTEGER NOT NULL DEFAULT 2 CHECK (guests >= 1 AND guests <= 50),
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_date
  ON reservations (restaurant_id, date);

CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_status
  ON reservations (restaurant_id, status);

COMMENT ON TABLE reservations IS 'Rezervime tavolinash për restorant (restaurant_id = clients.id)';
