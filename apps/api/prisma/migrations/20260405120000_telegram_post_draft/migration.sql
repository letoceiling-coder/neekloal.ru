-- AlterTable
ALTER TABLE "telegram_chats" ADD COLUMN IF NOT EXISTS "post_draft_topic" TEXT;
ALTER TABLE "telegram_chats" ADD COLUMN IF NOT EXISTS "post_draft_links" JSONB;
