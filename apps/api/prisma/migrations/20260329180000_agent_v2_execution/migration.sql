-- Agent V2: mode on agents + execution audit (multi-step)
ALTER TABLE "agents" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'v1';

CREATE TABLE "agent_executions" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_executions_agent_id_idx" ON "agent_executions"("agent_id");
CREATE INDEX "agent_executions_user_id_idx" ON "agent_executions"("user_id");
CREATE INDEX "agent_steps_execution_id_step_index_idx" ON "agent_steps"("execution_id", "step_index");

ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "agent_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
