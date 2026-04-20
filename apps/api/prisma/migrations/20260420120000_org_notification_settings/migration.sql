-- CreateTable: per-organization Telegram/email notification settings
-- All notification credentials and toggles live in DB (no env), so operators
-- can manage them from the admin panel. Env vars LEAD_NOTIFY_* remain as a
-- last-resort fallback for backward compatibility.

CREATE TABLE "organization_notification_settings" (
  "id"                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"        UUID        NOT NULL,

  -- Telegram (manager alerts)
  "tg_manager_bot_token"   TEXT,
  "tg_manager_chat_id"     TEXT,
  "tg_manager_enabled"     BOOLEAN     NOT NULL DEFAULT true,

  -- Alert triggers
  "notify_on_new_lead"     BOOLEAN     NOT NULL DEFAULT true,
  "notify_on_handoff"      BOOLEAN     NOT NULL DEFAULT true,
  "notify_on_hot_lead"     BOOLEAN     NOT NULL DEFAULT true,

  -- Email (optional, mirrors Telegram)
  "email_enabled"          BOOLEAN     NOT NULL DEFAULT false,
  "email_recipients"       TEXT,

  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_org_notification_settings_org"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_notification_settings_org_id_key"
  ON "organization_notification_settings"("organization_id");
