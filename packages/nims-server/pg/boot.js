'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const log = require('../libs/log')(module);
const {
  withClient,
  loadDatabaseFromProject,
  listProjectSlugs,
  saveDatabaseToProject,
  getAccountAuth,
} = require('../../nims-dbms/pg/storage');

function storageMode() {
  return (process.env.NIMS_STORAGE || 'json').toLowerCase();
}

function projectSlug() {
  return process.env.NIMS_PROJECT_SLUG || 'main';
}

function runMigrations() {
  const script = path.resolve(__dirname, '../../nims-dbms/scripts/migrate.js');
  const result = spawnSync(process.execPath, [script], {
    env: process.env,
    encoding: 'utf8',
  });
  if (result.stdout) log.info(result.stdout.trim());
  if (result.status !== 0) {
    if (result.stderr) log.error(result.stderr.trim());
    throw new Error(`PostgreSQL migrations failed (exit ${result.status})`);
  }
}

/**
 * Load Database document for boot. Returns null if project missing.
 */
async function loadBootDatabase() {
  runMigrations();
  return withClient(async (client) => {
    const slug = projectSlug();
    let loaded = await loadDatabaseFromProject(client, slug);
    if (loaded) {
      log.info(`Loaded project "${slug}" from PostgreSQL (id=${loaded.projectId})`);
      return loaded.database;
    }
    const slugs = await listProjectSlugs(client);
    if (slugs.length === 1) {
      loaded = await loadDatabaseFromProject(client, slugs[0]);
      log.info(`NIMS_PROJECT_SLUG="${slug}" missing; using sole project "${slugs[0]}"`);
      return loaded.database;
    }
    log.info(`No PostgreSQL project "${slug}" yet — will init from empty/JSON then persist`);
    return null;
  });
}

async function persistDatabase(database) {
  if (storageMode() !== 'postgres') return;
  await withClient((client) => saveDatabaseToProject(client, database, projectSlug()));
}

async function verifyAccountPassword(username, password, verifyFn) {
  return withClient(async (client) => {
    const rows = await getAccountAuth(client, username);
    if (!rows.length) return null;
    const row = rows[0];
    if (!row.salt || !row.password_hash) return null;
    if (!verifyFn(row.salt, row.password_hash, password)) return null;
    return {
      accountId: row.id,
      username: row.username,
      kind: row.kind,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      isAdmin: !!row.is_admin,
      isEditor: !!row.is_editor,
      playerProfileName: row.player_profile_name,
    };
  });
}

async function getMembershipFlags(username) {
  if (storageMode() !== 'postgres') return null;
  return withClient(async (client) => {
    const rows = await getAccountAuth(client, username);
    if (!rows.length) return null;
    const slug = projectSlug();
    const row = rows.find((r) => r.project_slug === slug) || rows[0];
    return {
      isAdmin: !!row.is_admin,
      isEditor: !!row.is_editor,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      kind: row.kind,
    };
  });
}

async function ownsEntity(username, entityType, entityName) {
  if (storageMode() !== 'postgres') return null;
  return withClient(async (client) => {
    const r = await client.query(
      `SELECT 1
       FROM entity_ownership eo
       JOIN accounts a ON a.id = eo.account_id
       JOIN projects p ON p.id = eo.project_id
       WHERE a.username = $1 AND eo.entity_type = $2 AND eo.entity_name = $3
         AND p.slug = $4 AND p.archived_at IS NULL
       LIMIT 1`,
      [username, entityType, entityName, projectSlug()],
    );
    return r.rows.length > 0;
  });
}

const READ_OR_AUTH = /^(get|is|has|login|ensure|subscribe)/;

/**
 * Proxy DBMS methods so mutating calls schedule a write-through persist (debounced).
 * @param {object} db
 * @param {() => Promise<object>} [getSnapshot] — prefer raw engine getDatabase
 */
function wrapDbForPersist(db, getSnapshot) {
  if (storageMode() !== 'postgres' || !db) return db;
  const snapshot = typeof getSnapshot === 'function'
    ? getSnapshot
    : () => db.getDatabase();
  let timer = null;
  let chain = Promise.resolve();
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      chain = chain
        .then(() => snapshot())
        .then((data) => persistDatabase(data))
        .catch((err) => {
          const msg = err && err.stack ? err.stack : (err && err.message ? err.message : err);
          log.error(`postgres write-through: ${msg}`);
        });
    }, 250);
  };
  return new Proxy(db, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      const name = String(prop);
      if (READ_OR_AUTH.test(name)) {
        return function (...args) {
          return val.apply(target, args);
        };
      }
      return function (...args) {
        const result = val.apply(target, args);
        return Promise.resolve(result).then((out) => {
          schedule();
          return out;
        });
      };
    },
  });
}

module.exports = {
  storageMode,
  projectSlug,
  runMigrations,
  loadBootDatabase,
  persistDatabase,
  verifyAccountPassword,
  getMembershipFlags,
  ownsEntity,
  wrapDbForPersist,
};
