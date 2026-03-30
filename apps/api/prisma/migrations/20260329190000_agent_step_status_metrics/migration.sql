-- Agent V2 hardening: step outcome + execution metrics
ALTER TABLE "agent_steps" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'success';

ALTER TABLE "agent_executions" ADD COLUMN "metrics" JSONB;
