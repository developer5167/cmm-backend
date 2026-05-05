-- 006_performance_indexes.sql
-- Targeted indexes for the most expensive query paths.
-- Run with: psql $DATABASE_URL -f 006_performance_indexes.sql

-- ── Notifications ─────────────────────────────────────────────
-- Used by activity bootstrap, notification list, and badge count
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read)
  WHERE is_read = false;

-- ── Interests ─────────────────────────────────────────────────
-- Used by interests list (received/sent tabs) and bootstrap badge
CREATE INDEX IF NOT EXISTS idx_interests_receiver_status
  ON interests (receiver_id, status);

CREATE INDEX IF NOT EXISTS idx_interests_sender_status
  ON interests (sender_id, status);

-- ── Messages ──────────────────────────────────────────────────
-- Used by unread badge count query in bootstrap
CREATE INDEX IF NOT EXISTS idx_messages_conv_unread
  ON messages (conversation_id, sender_id, is_read)
  WHERE is_read = false;

-- ── Profile views ─────────────────────────────────────────────
-- Used by activity/views endpoint
CREATE INDEX IF NOT EXISTS idx_profile_views_viewed_at
  ON profile_views (viewed_id, viewed_at DESC);

-- ── User photos ───────────────────────────────────────────────
-- Primary photo lookup appears in EVERY profile query as a correlated subquery
CREATE INDEX IF NOT EXISTS idx_user_photos_primary
  ON user_photos (user_id, is_primary, is_approved)
  WHERE is_primary = true AND is_approved = true;

-- ── Discover feed ─────────────────────────────────────────────
-- Supports gender / denomination / denomination / age filters
CREATE INDEX IF NOT EXISTS idx_profiles_gender_dob
  ON user_profiles (gender, date_of_birth);

CREATE INDEX IF NOT EXISTS idx_profiles_denomination
  ON user_profiles (denomination);

-- ── Shortlists ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shortlists_user
  ON shortlists (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shortlists_target
  ON shortlists (shortlisted_user_id);

-- ── Contact requests ──────────────────────────────────────────
-- Already partially indexed by 005 - add compound covering index
CREATE INDEX IF NOT EXISTS idx_contact_requests_requester_target
  ON contact_requests (requester_id, target_user_id, status);
