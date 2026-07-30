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
const { recordMutateAudit } = require('../../nims-dbms/pg/revisions');
const { roleFromMembership } = require('../../nims-dbms/pg/projectsApi');

let activeProjectSlug = process.env.NIMS_PROJECT_SLUG || 'main';

function storageMode() {
  return (process.env.NIMS_STORAGE || 'json').toLowerCase();
}

function projectSlug() {
  return activeProjectSlug || process.env.NIMS_PROJECT_SLUG || 'main';
}

function setActiveProjectSlug(slug) {
  if (slug) activeProjectSlug = String(slug);
  return activeProjectSlug;
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
      setActiveProjectSlug(slugs[0]);
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

async function loadProjectDatabase(slug) {
  return withClient(async (client) => loadDatabaseFromProject(client, slug));
}

function pickAuthRow(rows, preferredSlug) {
  if (!rows.length) return null;
  const active = rows.filter((r) => !r.membership_status || r.membership_status === 'active');
  const pool = active.length ? active : rows;
  if (preferredSlug) {
    const hit = pool.find((r) => r.project_slug === preferredSlug);
    if (hit) return hit;
  }
  return pool.find((r) => r.project_slug) || pool[0];
}

async function verifyAccountPassword(username, password, verifyFn) {
  return withClient(async (client) => {
    const rows = await getAccountAuth(client, username);
    if (!rows.length) return null;
    const row = rows[0];
    if (!row.salt || !row.password_hash) return null;
    if (!verifyFn(row.salt, row.password_hash, password)) return null;
    const preferred = pickAuthRow(rows, projectSlug());
    const membership = preferred && preferred.project_slug
      ? {
        member_role: preferred.member_role,
        is_admin: preferred.is_admin,
        is_editor: preferred.is_editor,
        status: preferred.membership_status,
      }
      : null;
    const isServerAdmin = !!row.is_server_admin;
    return {
      accountId: row.id,
      username: row.username,
      kind: row.kind,
      projectId: preferred?.project_id || null,
      projectSlug: preferred?.project_slug || null,
      isAdmin: !!(preferred && preferred.is_admin),
      isEditor: !!(preferred && preferred.is_editor),
      playerProfileName: preferred?.player_profile_name || null,
      isServerAdmin,
      memberRole: preferred?.member_role || null,
      role: roleFromMembership(membership, isServerAdmin),
    };
  });
}

async function getMembershipFlags(username) {
  if (storageMode() !== 'postgres') return null;
  return withClient(async (client) => {
    const rows = await getAccountAuth(client, username);
    if (!rows.length) return null;
    const row = pickAuthRow(rows, projectSlug()) || rows[0];
    return {
      isAdmin: !!row.is_admin,
      isEditor: !!row.is_editor,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      kind: row.kind,
      isServerAdmin: !!row.is_server_admin,
      memberRole: row.member_role || null,
      membershipStatus: row.membership_status || null,
      role: roleFromMembership(
        row.project_slug
          ? {
            member_role: row.member_role,
            is_admin: row.is_admin,
            is_editor: row.is_editor,
            status: row.membership_status,
          }
          : null,
        !!row.is_server_admin,
      ),
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

async function auditMutate({ command, args, username, ok, errorText, getDatabase }) {
  if (storageMode() !== 'postgres') return;
  try {
    await withClient(async (client) => {
      let database = null;
      if (ok && typeof getDatabase === 'function') {
        database = await getDatabase();
      }
      await recordMutateAudit(client, {
        slug: projectSlug(),
        database,
        command,
        args,
        username,
        ok,
        errorText,
      });
    });
  } catch (err) {
    log.error(`audit mutate failed: ${err && err.message ? err.message : err}`);
  }
}

const READ_OR_AUTH = /^(get|is|has|login|ensure|subscribe|list|setCurrent)/;

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
  setActiveProjectSlug,
  runMigrations,
  loadBootDatabase,
  persistDatabase,
  loadProjectDatabase,
  verifyAccountPassword,
  getMembershipFlags,
  ownsEntity,
  auditMutate,
  wrapDbForPersist,
};
