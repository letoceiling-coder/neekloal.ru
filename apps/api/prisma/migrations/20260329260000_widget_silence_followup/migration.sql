-- Follow-up ping for widget: one assistant reminder per user silence until user replies.
ALTER TABLE "conversations" ADD COLUMN "widget_silence_follow_up_sent_at" TIMESTAMP(3);
CREATE INDEX "conversations_widget_silence_follow_up_sent_at_idx" ON "conversations"("widget_silence_follow_up_sent_at");
