-- api_keys: allowed_domains for per-key origin restriction
ALTER TABLE "api_keys"
  ADD COLUMN "allowed_domains" TEXT[] NOT NULL DEFAULT '{}';
