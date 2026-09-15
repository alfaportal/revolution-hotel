-- Caktimi i tavolinave për secilin kamarier.
-- Tavolinat janë numra virtualë (1..N) të gjeneruar nga pos_areas.
-- Çdo tavolinë mund t'i caktohet vetëm një kamarieri (UNIQUE table_number për klient),
-- ndaj rikaktimi (nga një kamarier te tjetri) është thjesht një upsert.

CREATE TABLE IF NOT EXISTS pos_waiter_tables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  waiter_id     UUID NOT NULL REFERENCES pos_staff(id) ON DELETE CASCADE,
  table_number  INTEGER NOT NULL CHECK (table_number >= 1 AND table_number <= 30),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, table_number)
);

CREATE INDEX IF NOT EXISTS idx_pos_waiter_tables_client
  ON pos_waiter_tables (client_id);

CREATE INDEX IF NOT EXISTS idx_pos_waiter_tables_waiter
  ON pos_waiter_tables (client_id, waiter_id);
