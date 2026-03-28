-- Link agents to assistants (optional) + free-text rules for agent SYSTEM prompt
ALTER TABLE "agents" ADD COLUMN "assistant_id" UUID;
ALTER TABLE "agents" ADD COLUMN "rules" TEXT;

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "agents_assistant_id_idx" ON "agents"("assistant_id");
