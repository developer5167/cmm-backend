-- ============================================================
-- Profile Revision & Bio Update
-- ============================================================

CREATE TYPE revision_status_enum AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE profile_revisions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_name   VARCHAR(100) NOT NULL, -- e.g. 'bio', 'first_name', 'church_name'
  old_value    TEXT,
  new_value    TEXT,
  status       revision_status_enum NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by  UUID REFERENCES admin_users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for admin performance
CREATE INDEX idx_revisions_status ON profile_revisions(status, created_at DESC);
CREATE INDEX idx_revisions_user ON profile_revisions(user_id);

-- Rename bio to ai_bio if needed, or just keep it as the primary bio field
-- For now, we will use 'bio' as the field user edits.
