-- Lead visitor context + pipeline CLOSED for widget / sales flow
ALTER TYPE "LeadPipelineStatus" ADD VALUE 'CLOSED';

ALTER TABLE "leads" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "leads" ADD COLUMN "referer" TEXT;
ALTER TABLE "leads" ADD COLUMN "first_message" TEXT;
