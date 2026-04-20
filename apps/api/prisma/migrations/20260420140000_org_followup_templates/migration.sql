-- Per-organization follow-up sequences (Avito / future channels).
-- "step" is the position in the ordered sequence (1, 2, 3, …).
-- delay_minutes is counted from the last inbound user message (after cancel+reschedule).
-- If an organization has zero active templates, the hard-coded defaults in
-- avito.followup.{queue,processor}.js still apply (backward compatibility).

CREATE TABLE "organization_followup_templates" (
  "id"              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID          NOT NULL,

  "step"            INTEGER       NOT NULL,
  "delay_minutes"   INTEGER       NOT NULL,
  "text"            TEXT          NOT NULL,
  "is_active"       BOOLEAN       NOT NULL DEFAULT true,

  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_org_followup_templates_org"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "org_followup_templates_delay_positive"
    CHECK ("delay_minutes" >= 1 AND "delay_minutes" <= 10080),

  CONSTRAINT "org_followup_templates_step_positive"
    CHECK ("step" >= 1 AND "step" <= 50)
);

CREATE UNIQUE INDEX "org_followup_templates_org_step_key"
  ON "organization_followup_templates"("organization_id", "step");

CREATE INDEX "org_followup_templates_org_active_idx"
  ON "organization_followup_templates"("organization_id", "is_active");
