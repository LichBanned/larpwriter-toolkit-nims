'use strict';

/**
 * Shared Postgres fixture for nims-dbms / nims-server integration tests.
 * Requires DATABASE_URL — fails hard if missing (Docker-only harness).
 */

const crypto = require('crypto');
const emptyBase = require('nims-resources/emptyBase');
const {
  withClient,
  resetPool,
  setAccountPassword,
} = require('../../pg/storage');

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required — run via docker compose -f docker-compose.test.yml');
  }
}

function uniqueSlug(prefix = 't') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function scryptCreds(password) {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const hashedPassword = crypto.scryptSync(password, saltHex, 64).toString('hex');
  return { salt: `scrypt$${saltHex}`, hashedPassword };
}

function minimalDatabase(overrides = {}) {
  const data = structuredClone(emptyBase.data);
  data.Version = '0.8.0';
  data.Meta = { ...(data.Meta || {}), name: 'test', ...(overrides.Meta || {}) };
  data.Characters = overrides.Characters || {};
  data.Players = overrides.Players || {};
  data.Stories = overrides.Stories || {};
  data.Groups = overrides.Groups || {};
  data.Relations = overrides.Relations || [];
  data.ManagementInfo = {
    UsersInfo: {},
    PlayersInfo: {},
    admins: [],
    editors: [],
    adaptationRights: 'ByStory',
    WelcomeText: '',
    PlayersOptions: {
      allowPlayerCreation: true,
      allowCharacterCreation: false,
      allowRoleGridView: true,
    },
    ...(overrides.ManagementInfo || {}),
  };
  return data;
}

async function truncateAll() {
  requireDatabaseUrl();
  await withClient(async (client) => {
    // Serialize truncate against concurrent suites / leftover locks.
    await client.query('SELECT pg_advisory_lock(872364)');
    try {
      await client.query(`
      TRUNCATE
        entity_revisions,
        command_log,
        entity_ownership,
        project_memberships,
        project_documents,
        sliders,
        gears_edges,
        gears_nodes,
        gears_settings,
        group_members,
        groups,
        relation_texts,
        relations,
        event_adaptations,
        story_events,
        story_characters,
        stories,
        profile_bindings,
        questionnaires,
        players,
        characters,
        profile_field_defs,
        projects,
        accounts
      RESTART IDENTITY CASCADE
    `);
    } finally {
      await client.query('SELECT pg_advisory_unlock(872364)');
    }
  });
}

async function ensureAccount(username, password, {
  kind = 'organizer',
  isServerAdmin = false,
} = {}) {
  const { salt, hashedPassword } = scryptCreds(password);
  return withClient(async (client) => {
    await setAccountPassword(client, username, salt, hashedPassword, kind);
    if (isServerAdmin) {
      await client.query(
        `UPDATE accounts SET is_server_admin = true WHERE username = $1`,
        [username],
      );
    }
    const r = await client.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
    return r.rows[0].id;
  });
}

async function afterAllCleanup() {
  try {
    await resetPool();
  } catch {
    /* ignore */
  }
}

module.exports = {
  requireDatabaseUrl,
  uniqueSlug,
  scryptCreds,
  minimalDatabase,
  truncateAll,
  ensureAccount,
  afterAllCleanup,
  withClient,
};
