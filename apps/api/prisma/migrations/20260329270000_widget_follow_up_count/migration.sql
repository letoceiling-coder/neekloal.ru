-- Cap automated widget follow-ups per conversation (see widgetFollowUp.js).
ALTER TABLE "conversations" ADD COLUMN "widget_follow_up_count" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "conversations_widget_follow_up_count_idx" ON "conversations"("widget_follow_up_count");

-- Ранее уже уходило одно follow-up (старый флаг) — учесть в счётчике, чтобы не слать лишние.
UPDATE "conversations"
SET "widget_follow_up_count" = 1
WHERE "widget_silence_follow_up_sent_at" IS NOT NULL;
