-- Agent execution counters for billing / analytics
ALTER TABLE "agent_executions" ADD COLUMN "steps_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agent_executions" ADD COLUMN "tool_calls" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agent_executions" ADD COLUMN "duration_ms" INTEGER;
ALTER TABLE "agent_executions" ADD COLUMN "total_tokens" INTEGER NOT NULL DEFAULT 0;
