-- knowledge: source_name (file name / URL) + status (processing|ready|failed)
ALTER TABLE "knowledge" ADD COLUMN "source_name" TEXT;
ALTER TABLE "knowledge" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready';
