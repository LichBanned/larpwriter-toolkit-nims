-- History + multiproject extensions
BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_server_admin boolean NOT NULL DEFAULT false;

ALTER TABLE project_memberships
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE project_memberships
  ADD COLUMN IF NOT EXISTS member_role text NOT NULL DEFAULT 'organizer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_project_memberships_status'
  ) THEN
    ALTER TABLE project_memberships
      ADD CONSTRAINT ck_project_memberships_status
      CHECK (status IN ('pending', 'active', 'rejected'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_project_memberships_member_role'
  ) THEN
    ALTER TABLE project_memberships
      ADD CONSTRAINT ck_project_memberships_member_role
      CHECK (member_role IN ('organizer', 'player'));
  END IF;
END $$;

-- Backfill: player-kind accounts → player membership role
UPDATE project_memberships m
SET member_role = 'player'
FROM accounts a
WHERE a.id = m.account_id
  AND a.kind IN ('player')
  AND m.member_role = 'organizer'
  AND m.is_admin IS NOT TRUE
  AND m.is_editor IS NOT TRUE;

COMMIT;
