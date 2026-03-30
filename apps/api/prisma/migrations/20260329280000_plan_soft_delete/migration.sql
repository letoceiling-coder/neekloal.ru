-- Plan soft delete + partial unique slug (active rows only)

ALTER TABLE "plans" ADD COLUMN "deleted_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "plans_slug_key";

CREATE UNIQUE INDEX "plans_slug_active_key" ON "plans"("slug") WHERE "deleted_at" IS NULL;
