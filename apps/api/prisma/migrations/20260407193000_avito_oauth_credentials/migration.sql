-- AlterTable
ALTER TABLE "avito_accounts"
ADD COLUMN "client_id" TEXT,
ADD COLUMN "client_secret" TEXT,
ADD COLUMN "access_token_expires_at" TIMESTAMP(3);

