-- CreateTable
CREATE TABLE "video_generation_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "image_url" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "voice_text" TEXT,
    "output_url" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_generation_jobs_user_id_idx" ON "video_generation_jobs"("user_id");
CREATE INDEX "video_generation_jobs_organization_id_idx" ON "video_generation_jobs"("organization_id");
CREATE INDEX "video_generation_jobs_status_idx" ON "video_generation_jobs"("status");

-- AddForeignKey
ALTER TABLE "video_generation_jobs" ADD CONSTRAINT "video_generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
