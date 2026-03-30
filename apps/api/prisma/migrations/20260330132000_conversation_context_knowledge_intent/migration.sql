-- Hybrid sales v2:
-- - conversations.context (JSONB) for memory
-- - knowledge.intent for routing

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "context" JSONB;

ALTER TABLE "knowledge"
  ADD COLUMN IF NOT EXISTS "intent" TEXT;

