-- Hapësira (terasa, sallë) dhe rolet e stafit

CREATE TABLE IF NOT EXISTS pos_areas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  table_count   INTEGER NOT NULL DEFAULT 1 CHECK (table_count >= 0 AND table_count <= 30),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_areas_client ON pos_areas (client_id, sort_order);

ALTER TABLE pos_staff
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'waiter';

ALTER TABLE pos_staff
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE pos_staff
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_staff_role_check'
  ) THEN
    ALTER TABLE pos_staff
      ADD CONSTRAINT pos_staff_role_check
      CHECK (role IN ('waiter', 'kitchen'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_staff_source_check'
  ) THEN
    ALTER TABLE pos_staff
      ADD CONSTRAINT pos_staff_source_check
      CHECK (source IN ('owner', 'pos'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_staff_role ON pos_staff (client_id, role, active);
