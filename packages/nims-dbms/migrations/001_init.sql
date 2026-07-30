-- NIMS PostgreSQL schema v1
-- Multi-project ready; audit tables present (product UI later)

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename    text NOT NULL UNIQUE,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              text NOT NULL,
  name              text NOT NULL DEFAULT '',
  description       text NOT NULL DEFAULT '',
  game_date         text NOT NULL DEFAULT '',
  pre_game_date     text NOT NULL DEFAULT '',
  schema_version    text NOT NULL DEFAULT '0.8.0',
  adaptation_rights text NOT NULL DEFAULT 'ByStory',
  welcome_text      text NOT NULL DEFAULT '',
  players_options   jsonb NOT NULL DEFAULT '{"allowPlayerCreation":false,"allowCharacterCreation":false}'::jsonb,
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_blobs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  CONSTRAINT uq_projects_slug UNIQUE (slug),
  CONSTRAINT ck_projects_adaptation_rights CHECK (adaptation_rights IN ('', 'ByStory', 'ByCharacter'))
);

CREATE TABLE accounts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username        text NOT NULL,
  salt            text,
  password_hash   text,
  kind            text NOT NULL DEFAULT 'organizer',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_accounts_username UNIQUE (username),
  CONSTRAINT ck_accounts_kind CHECK (kind IN ('organizer', 'player', 'both'))
);

CREATE TABLE project_memberships (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id        bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_admin          boolean NOT NULL DEFAULT false,
  is_editor         boolean NOT NULL DEFAULT false,
  player_profile_name text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_memberships UNIQUE (project_id, account_id)
);
CREATE INDEX ix_project_memberships_account ON project_memberships(account_id);
CREATE INDEX ix_project_memberships_project ON project_memberships(project_id);

CREATE TABLE profile_field_defs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_type    text NOT NULL,
  name            text NOT NULL,
  field_type      text NOT NULL,
  default_value   jsonb NOT NULL DEFAULT '""'::jsonb,
  player_access   text NOT NULL DEFAULT 'write',
  do_export       boolean NOT NULL DEFAULT true,
  show_in_role_grid boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_profile_field_defs UNIQUE (project_id, profile_type, name),
  CONSTRAINT ck_profile_field_defs_type CHECK (profile_type IN ('character', 'player', 'questionnaire')),
  CONSTRAINT ck_profile_field_defs_field_type CHECK (field_type IN ('text', 'string', 'enum', 'number', 'checkbox', 'multiEnum')),
  CONSTRAINT ck_profile_field_defs_access CHECK (player_access IN ('write', 'readonly', 'hidden'))
);
CREATE INDEX ix_profile_field_defs_project ON profile_field_defs(project_id);

CREATE TABLE characters (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_characters_project_name ON characters(project_id, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_characters_project ON characters(project_id);

CREATE TABLE players (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_players_project_name ON players(project_id, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_players_project ON players(project_id);

CREATE TABLE questionnaires (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_questionnaires_project_name ON questionnaires(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE profile_bindings (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id  bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_profile_bindings_character UNIQUE (character_id)
);
CREATE INDEX ix_profile_bindings_project ON profile_bindings(project_id);
CREATE INDEX ix_profile_bindings_player ON profile_bindings(player_id);

CREATE TABLE stories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  master_text  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX uq_stories_project_name ON stories(project_id, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_stories_project ON stories(project_id);

CREATE TABLE story_characters (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  story_id      bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  character_id  bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  inventory     text NOT NULL DEFAULT '',
  activity      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_story_characters UNIQUE (story_id, character_id)
);
CREATE INDEX ix_story_characters_character ON story_characters(character_id);

CREATE TABLE story_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  story_id    bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  name        text NOT NULL DEFAULT '',
  text        text NOT NULL DEFAULT '',
  time        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_story_events_story ON story_events(story_id, sort_order);

CREATE TABLE event_adaptations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
  character_id  bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  text          text NOT NULL DEFAULT '',
  time          text NOT NULL DEFAULT '',
  ready         boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_adaptations UNIQUE (event_id, character_id)
);
CREATE INDEX ix_event_adaptations_character ON event_adaptations(character_id);

CREATE TABLE relations (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id          bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  starter_id          bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ender_id            bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  origin              text NOT NULL DEFAULT '',
  essence             text[] NOT NULL DEFAULT '{}',
  starter_text_ready  boolean NOT NULL DEFAULT false,
  ender_text_ready    boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_relations_pair UNIQUE (project_id, starter_id, ender_id),
  CONSTRAINT ck_relations_different CHECK (starter_id <> ender_id)
);
CREATE INDEX ix_relations_project ON relations(project_id);

CREATE TABLE relation_texts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  relation_id   bigint NOT NULL REFERENCES relations(id) ON DELETE CASCADE,
  character_id  bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  text          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_relation_texts UNIQUE (relation_id, character_id)
);

CREATE TABLE groups (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id             bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  master_description     text NOT NULL DEFAULT '',
  character_description  text NOT NULL DEFAULT '',
  do_export              boolean NOT NULL DEFAULT true,
  filter_model           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
CREATE UNIQUE INDEX uq_groups_project_name ON groups(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE group_members (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id      bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  character_id  bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_group_members UNIQUE (group_id, character_id)
);

CREATE TABLE gears_nodes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_key    text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gears_nodes UNIQUE (project_id, node_key)
);

CREATE TABLE gears_edges (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  edge_key    text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gears_edges UNIQUE (project_id, edge_key)
);

CREATE TABLE gears_settings (
  project_id  bigint PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{"physicsEnabled":true,"showNotes":true}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sliders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  name        text NOT NULL DEFAULT '',
  top         text NOT NULL DEFAULT '',
  bottom      text NOT NULL DEFAULT '',
  value       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sliders_project ON sliders(project_id, sort_order);

CREATE TABLE entity_ownership (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type   text NOT NULL,
  entity_name   text NOT NULL,
  account_id    bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_ownership UNIQUE (project_id, entity_type, entity_name),
  CONSTRAINT ck_entity_ownership_type CHECK (entity_type IN ('character', 'player', 'story', 'group'))
);
CREATE INDEX ix_entity_ownership_account ON entity_ownership(account_id);

CREATE TABLE entity_revisions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type       text NOT NULL,
  entity_id         text NOT NULL,
  revision          int NOT NULL,
  snapshot          jsonb NOT NULL,
  actor_account_id  bigint REFERENCES accounts(id) ON DELETE SET NULL,
  command           text,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_revisions UNIQUE (project_id, entity_type, entity_id, revision)
);
CREATE INDEX ix_entity_revisions_lookup ON entity_revisions(project_id, entity_type, entity_id, revision DESC);

CREATE TABLE command_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    bigint REFERENCES projects(id) ON DELETE SET NULL,
  account_id    bigint REFERENCES accounts(id) ON DELETE SET NULL,
  command       text NOT NULL,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok            boolean NOT NULL DEFAULT true,
  error_text    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_command_log_project ON command_log(project_id, created_at DESC);

-- Working document mirror for fast hydrate (optional cache of full Database JSON)
CREATE TABLE project_documents (
  project_id  bigint PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  document    jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
