-- Auth: password + password reset on users
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "password_reset_token" TEXT;
ALTER TABLE "users" ADD COLUMN "password_reset_expires" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_password_reset_token_key" ON "users"("password_reset_token");
