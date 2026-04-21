-- Per-organization external AI provider API keys (OpenAI, Anthropic, Google, xAI, …)

CREATE TABLE "organization_ai_integrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "api_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_ai_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_ai_integrations_organization_id_provider_key"
  ON "organization_ai_integrations"("organization_id", "provider");

CREATE INDEX "organization_ai_integrations_organization_id_is_enabled_idx"
  ON "organization_ai_integrations"("organization_id", "is_enabled");

ALTER TABLE "organization_ai_integrations"
  ADD CONSTRAINT "organization_ai_integrations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
