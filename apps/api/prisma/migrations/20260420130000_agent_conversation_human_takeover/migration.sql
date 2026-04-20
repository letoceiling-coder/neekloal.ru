-- AgentConversation: manager "take over" (pause AI on specific dialog).
-- When human_takeover_at is NOT NULL — AI must stop replying to that conversation
-- until it is released again (human_takeover_at = NULL).

ALTER TABLE "agent_conversations"
  ADD COLUMN "human_takeover_at"   TIMESTAMP(3),
  ADD COLUMN "human_takeover_by"   UUID,
  ADD COLUMN "human_takeover_note" TEXT;

-- Foreign key to users (who took over). ON DELETE SET NULL so deleting a manager
-- never orphans the conversation.
ALTER TABLE "agent_conversations"
  ADD CONSTRAINT "fk_agent_conversations_human_takeover_by"
  FOREIGN KEY ("human_takeover_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Quick filter: "all paused conversations" per org.
CREATE INDEX "agent_conversations_human_takeover_at_idx"
  ON "agent_conversations"("human_takeover_at")
  WHERE "human_takeover_at" IS NOT NULL;
