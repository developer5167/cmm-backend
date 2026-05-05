-- Allow multiple devices per user and keep one token bound to one user.
-- Old model (UNIQUE(user_id, device_type)) caused token overwrites.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fcm_tokens_user_id_device_type_key'
  ) THEN
    ALTER TABLE fcm_tokens DROP CONSTRAINT fcm_tokens_user_id_device_type_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fcm_tokens_token_key'
  ) THEN
    ALTER TABLE fcm_tokens
      ADD CONSTRAINT fcm_tokens_token_key UNIQUE (token);
  END IF;
END $$;

