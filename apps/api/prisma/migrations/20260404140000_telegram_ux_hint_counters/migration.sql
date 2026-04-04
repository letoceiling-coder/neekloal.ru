-- AlterTable
ALTER TABLE "telegram_chats" ADD COLUMN "ux_hint_image" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "telegram_chats" ADD COLUMN "ux_hint_chat" INTEGER NOT NULL DEFAULT 0;
