-- api_keys: add optional assistant_id for per-assistant public keys
ALTER TABLE "api_keys"
  ADD COLUMN "assistant_id" UUID REFERENCES "assistants"("id") ON DELETE SET NULL;

CREATE INDEX "api_keys_assistant_id_idx" ON "api_keys"("assistant_id");
