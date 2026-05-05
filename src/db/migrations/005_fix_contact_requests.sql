-- Fix contact_requests table:
-- 1. Rename requested_user_id → target_user_id to match controller naming
-- 2. Make conversation_id nullable (contact requests don't always require a prior conversation)

ALTER TABLE contact_requests
  RENAME COLUMN requested_user_id TO target_user_id;

ALTER TABLE contact_requests
  ALTER COLUMN conversation_id DROP NOT NULL;

-- Add index for fast incoming-request lookups
CREATE INDEX IF NOT EXISTS idx_contact_requests_target
  ON contact_requests(target_user_id, status);
