ALTER TABLE ai_ceo_commands
  ADD COLUMN IF NOT EXISTS requester_phone TEXT,
  ADD COLUMN IF NOT EXISTS requester_chat_id TEXT;

