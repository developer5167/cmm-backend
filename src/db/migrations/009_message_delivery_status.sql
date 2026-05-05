-- Persistent delivery status for chat ticks
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_delivery
  ON messages (conversation_id, delivered_at, read_at, created_at DESC);

