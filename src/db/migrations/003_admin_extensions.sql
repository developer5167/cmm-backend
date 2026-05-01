-- ============================================================
-- Admin Extensions: Locking, Audit Logs & Staff Notes
-- ============================================================

-- Add locking to revisions
ALTER TABLE profile_revisions ADD COLUMN locked_by UUID REFERENCES admin_users(id);
ALTER TABLE profile_revisions ADD COLUMN locked_at TIMESTAMPTZ;

-- Audit Logs for tracking every admin/staff action
CREATE TABLE admin_audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id     UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  action       VARCHAR(100) NOT NULL, -- e.g. 'APPROVE_REVISION', 'DEACTIVATE_STAFF'
  target_type  VARCHAR(50),           -- e.g. 'user', 'revision', 'staff'
  target_id    UUID,
  details      JSONB DEFAULT '{}',
  ip_address   VARCHAR(45),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Internal Notes for Staff collaboration
CREATE TABLE admin_internal_notes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id     UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  note         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for performance
CREATE INDEX idx_audit_admin ON admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_internal_notes_user ON admin_internal_notes(user_id);
