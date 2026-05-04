-- Photo Review System
-- Each uploaded photo goes through individual admin review before becoming visible

-- Add review workflow columns to user_photos
ALTER TABLE user_photos
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- New uploads default to pending (not auto-approved)
ALTER TABLE user_photos ALTER COLUMN is_approved SET DEFAULT false;

-- Backfill: existing approved photos are considered approved
UPDATE user_photos SET review_status = 'approved' WHERE is_approved = true;
-- Backfill: any previously unapproved photos stay as pending
UPDATE user_photos SET review_status = 'pending' WHERE is_approved = false;

-- Index for fast admin pending photos query
CREATE INDEX IF NOT EXISTS idx_photos_review_status ON user_photos(review_status, created_at);
