-- Telegram integration (bots, users, chats)

CREATE TABLE "telegram_bots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_token" TEXT NOT NULL,
    "bot_username" TEXT,
    "webhook_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_bots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_bots_user_id_key" ON "telegram_bots"("user_id");
CREATE INDEX "telegram_bots_organization_id_idx" ON "telegram_bots"("organization_id");

ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_users" (
    "id" UUID NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_users_telegram_id_key" ON "telegram_users"("telegram_id");

CREATE TABLE "telegram_chats" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_id" UUID,
    "conversation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_chats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_chats_bot_id_telegram_chat_id_key" ON "telegram_chats"("bot_id", "telegram_chat_id");
CREATE INDEX "telegram_chats_user_id_idx" ON "telegram_chats"("user_id");

ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "telegram_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
