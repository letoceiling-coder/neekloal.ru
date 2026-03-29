-- Platform role for admin panel (root-only routes)

CREATE TYPE "UserRole" AS ENUM ('user', 'admin', 'root');

ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user';
