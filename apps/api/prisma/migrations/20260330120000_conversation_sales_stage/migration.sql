-- Hybrid sales FSM: dialogue stage per conversation
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "sales_stage" TEXT NOT NULL DEFAULT 'greeting';
