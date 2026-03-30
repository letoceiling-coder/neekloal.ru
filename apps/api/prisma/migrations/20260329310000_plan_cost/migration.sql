-- plans: cost_per_1k_tokens for cost tracking in usage records
ALTER TABLE "plans"
  ADD COLUMN "cost_per_1k_tokens" DECIMAL(12, 6);
