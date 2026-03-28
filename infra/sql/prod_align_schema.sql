-- One-time production alignment: legacy user-scoped → org-scoped (PostgreSQL)
-- Safe when assistants/agents/usage rows are empty or migratable.

DO $$ BEGIN
  CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role "MembershipRole" NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP(3),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS memberships_organization_id_idx ON memberships(organization_id);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships(user_id);

-- Seed one organization + OWNER membership per user (idempotent)
DO $$
DECLARE
  r RECORD;
  oid UUID;
BEGIN
  FOR r IN SELECT id, email FROM users LOOP
    IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = r.id) THEN
      oid := gen_random_uuid();
      INSERT INTO organizations (id, name, slug, created_at, updated_at)
      VALUES (
        oid,
        COALESCE(NULLIF(split_part(r.email, '@', 1), ''), 'Workspace'),
        'o-' || replace(gen_random_uuid()::text, '-', ''),
        NOW(),
        NOW()
      );
      INSERT INTO memberships (id, user_id, organization_id, role, created_at, updated_at)
      VALUES (gen_random_uuid(), r.id, oid, 'OWNER', NOW(), NOW());
    END IF;
  END LOOP;
END $$;

-- users.updated_at (Prisma @updatedAt)
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- api_keys: add org columns, migrate off user_id
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP(3);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE api_keys k
SET organization_id = m.organization_id
FROM memberships m
WHERE m.user_id = k.user_id AND k.organization_id IS NULL;

UPDATE api_keys SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE api_keys ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE api_keys ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_user_id_fkey;
ALTER TABLE api_keys DROP COLUMN IF EXISTS user_id;

-- Empty legacy tables: drop so Prisma can recreate org-scoped models (verified 0 rows in prod)
DROP TABLE IF EXISTS agent_steps CASCADE;
DROP TABLE IF EXISTS agent_executions CASCADE;
DROP TABLE IF EXISTS tools CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS knowledge_chunks CASCADE;
DROP TABLE IF EXISTS knowledge CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS assistants CASCADE;

-- usage: add org scope + Prisma columns (0 rows in prod)
ALTER TABLE usage ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE usage u SET organization_id = m.organization_id FROM memberships m WHERE m.user_id = u.user_id AND u.organization_id IS NULL;
ALTER TABLE usage ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE usage ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE usage ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
