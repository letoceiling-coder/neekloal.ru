-- Plan & org usage limits (SaaS metering)

CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_requests_per_month" INTEGER,
    "max_tokens_per_month" INTEGER,
    "allowed_models" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

INSERT INTO "plans" ("id", "slug", "name", "max_requests_per_month", "max_tokens_per_month", "allowed_models", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'free', 'Free', 100, 50000, '["*"]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'pro', 'Pro', 5000, 2000000, '["*"]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'enterprise', 'Enterprise', NULL, NULL, '["*"]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "organizations" ADD COLUMN "plan_id" UUID;
ALTER TABLE "organizations" ADD COLUMN "requests_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organizations" ADD COLUMN "tokens_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organizations" ADD COLUMN "reset_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "is_blocked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "organizations" o
SET "plan_id" = (SELECT p.id FROM "plans" p WHERE p.slug = 'free' LIMIT 1)
WHERE o."plan_id" IS NULL;

UPDATE "organizations"
SET "reset_at" = date_trunc('month', timezone('utc', now())) + interval '1 month'
WHERE "reset_at" IS NULL;

ALTER TABLE "organizations" ALTER COLUMN "plan_id" SET NOT NULL;
ALTER TABLE "organizations" ALTER COLUMN "reset_at" SET NOT NULL;

CREATE INDEX "organizations_plan_id_idx" ON "organizations"("plan_id");

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
