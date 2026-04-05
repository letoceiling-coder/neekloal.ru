-- AlterTable
ALTER TABLE "telegram_bots" ADD COLUMN IF NOT EXISTS "webhook_secret_token" TEXT;
ALTER TABLE "telegram_chats" ADD COLUMN IF NOT EXISTS "post_style" TEXT;
ALTER TABLE "telegram_chats" ADD COLUMN IF NOT EXISTS "post_platform" TEXT;
ALTER TABLE "telegram_chats" ADD COLUMN IF NOT EXISTS "post_tone" TEXT;
ALTER TABLE "telegram_chats" ADD COLUMN IF NOT EXISTS "post_last_generated" JSONB;
