-- Remote control per Hardware ID: revoke / reactivate / wipe (local POS only)
-- Super Admin UI → heartbeat (~15s) → POS quit or factory-reset

CREATE TABLE IF NOT EXISTS license_hardware_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  hardware_id TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  wipe_requested_at TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, hardware_id)
);

CREATE INDEX IF NOT EXISTS idx_license_hw_controls_license
  ON license_hardware_controls (license_id);

CREATE INDEX IF NOT EXISTS idx_license_hw_controls_hw
  ON license_hardware_controls (hardware_id);

CREATE TABLE IF NOT EXISTS license_remote_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID REFERENCES licenses(id) ON DELETE SET NULL,
  hardware_id TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id UUID,
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_remote_audit_license
  ON license_remote_audit (license_id, created_at DESC);

COMMENT ON TABLE license_hardware_controls IS
  'Per-Hardware-ID revoke / wipe flags. License-wide statusi=revokuar still applies to all devices.';
COMMENT ON TABLE license_remote_audit IS
  'Audit trail for Super Admin revoke / reactivate / wipe-data actions.';
