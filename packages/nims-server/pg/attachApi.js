'use strict';

/**
 * Attach history + multiproject API methods onto the raw DBMS object.
 */

const { withClient } = require('../../nims-dbms/pg/storage');
const {
  listEntityRevisions,
  getEntityRevision,
  insertEntityRevision,
  cleanupOldRevisions,
  snapshotEntity,
  resolveProjectId,
  resolveAccountId,
} = require('../../nims-dbms/pg/revisions');
const {
  listProjectsForUser,
  createProject,
  archiveProject,
  getMembershipForUser,
  roleFromMembership,
  requestProjectJoin,
  mergeActivePlayerMemberships,
} = require('../../nims-dbms/pg/projectsApi');
const pgBoot = require('./boot');

function attachHistoryAndProjectsApi(rawDb, dbmsRef) {
  rawDb.listEntityRevisions = async function listEntityRevisionsApi(args = {}) {
    if (pgBoot.storageMode() !== 'postgres') return [];
    const { entityType, entityId, limit } = args;
    return withClient((client) => listEntityRevisions(client, {
      slug: pgBoot.projectSlug(),
      entityType,
      entityId,
      limit,
    }));
  };

  rawDb.getEntityRevision = async function getEntityRevisionApi(args = {}) {
    if (pgBoot.storageMode() !== 'postgres') return null;
    return withClient((client) => getEntityRevision(client, {
      slug: pgBoot.projectSlug(),
      entityType: args.entityType,
      entityId: args.entityId,
      revision: args.revision,
    }));
  };

  rawDb.restoreEntityRevision = async function restoreEntityRevisionApi(args = {}, user) {
    if (pgBoot.storageMode() !== 'postgres') {
      throw Object.assign(new Error('postgres-only'), { messageId: 'errors-forbidden' });
    }
    const rev = await withClient((client) => getEntityRevision(client, {
      slug: pgBoot.projectSlug(),
      entityType: args.entityType,
      entityId: args.entityId,
      revision: args.revision,
    }));
    if (!rev) {
      throw Object.assign(new Error('revision-not-found'), { messageId: 'errors-entity-is-not-exist' });
    }
    const database = await rawDb.getDatabase();
    const snap = rev.snapshot || {};
    const type = args.entityType;
    const id = args.entityId;

    if (type === 'character') {
      if (snap.deleted) {
        if (database.Characters && database.Characters[id]) delete database.Characters[id];
      } else if (snap.fields) {
        database.Characters = database.Characters || {};
        database.Characters[id] = snap.fields;
      }
    } else if (type === 'player') {
      if (snap.deleted) {
        if (database.Players && database.Players[id]) delete database.Players[id];
      } else if (snap.fields) {
        database.Players = database.Players || {};
        database.Players[id] = snap.fields;
      }
    } else if (type === 'story') {
      if (snap.deleted) {
        if (database.Stories && database.Stories[id]) delete database.Stories[id];
      } else if (snap.story) {
        database.Stories = database.Stories || {};
        database.Stories[id] = snap.story;
      }
    } else if (type === 'group') {
      if (snap.deleted) {
        if (database.Groups && database.Groups[id]) delete database.Groups[id];
      } else if (snap.group) {
        database.Groups = database.Groups || {};
        database.Groups[id] = snap.group;
      }
    } else if (type === 'relation' && snap.relation) {
      database.Relations = database.Relations || [];
      const [a, b] = String(id).split('|');
      const idx = database.Relations.findIndex(
        (r) => (r.starter === a && r.ender === b) || (r.starter === b && r.ender === a),
      );
      if (snap.deleted) {
        if (idx >= 0) database.Relations.splice(idx, 1);
      } else if (idx >= 0) database.Relations[idx] = snap.relation;
      else database.Relations.push(snap.relation);
    }

    await rawDb.setDatabase({ database, preserveManagementInfo: true });

    await withClient(async (client) => {
      const projectId = await resolveProjectId(client, pgBoot.projectSlug());
      const accountId = user && user.name ? await resolveAccountId(client, user.name) : null;
      const after = await rawDb.getDatabase();
      await insertEntityRevision(client, {
        projectId,
        entityType: type,
        entityId: id,
        snapshot: snapshotEntity(after, type, id),
        accountId,
        command: 'restoreEntityRevision',
        reason: 'restore',
      });
    });
    return { ok: true, entityType: type, entityId: id, restoredFrom: rev.revision };
  };

  rawDb.cleanupEntityRevisions = async function cleanupEntityRevisionsApi(args = {}) {
    if (pgBoot.storageMode() !== 'postgres') return { deleted: 0 };
    return withClient((client) => cleanupOldRevisions(client, {
      slug: args.slug || pgBoot.projectSlug(),
      keepLast: args.keepLast,
    }));
  };

  rawDb.listProjects = async function listProjectsApi(args = {}, user) {
    if (pgBoot.storageMode() !== 'postgres') {
      return [{
        id: 1,
        slug: 'main',
        name: 'main',
        member_role: user && user.role === 'player' ? 'player' : 'organizer',
        membership_status: 'active',
      }];
    }
    const flags = user && user.name ? await pgBoot.getMembershipFlags(user.name) : null;
    const isServerAdmin = !!(user && user.isServerAdmin) || !!(flags && flags.isServerAdmin);
    return withClient((client) => listProjectsForUser(client, {
      username: user && user.name,
      isServerAdmin,
      includeJoinable: !!(args && args.includeJoinable),
    }));
  };

  rawDb.createProject = async function createProjectApi(args = {}, user) {
    if (pgBoot.storageMode() !== 'postgres') {
      throw Object.assign(new Error('postgres-only'), { messageId: 'errors-forbidden' });
    }
    const slug = String(args.slug || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(slug)) {
      throw Object.assign(new Error('bad-slug'), { messageId: 'errors-argument-is-incorrect' });
    }
    return withClient((client) => createProject(client, {
      slug,
      name: args.name || slug,
      description: args.description || '',
      creatorUsername: user && user.name,
    }));
  };

  rawDb.archiveProject = async function archiveProjectApi(args = {}) {
    if (pgBoot.storageMode() !== 'postgres') {
      throw Object.assign(new Error('postgres-only'), { messageId: 'errors-forbidden' });
    }
    const row = await withClient((client) => archiveProject(client, { slug: args.slug }));
    if (!row) {
      throw Object.assign(new Error('project-not-found'), { messageId: 'errors-entity-is-not-exist' });
    }
    return row;
  };

  rawDb.setCurrentProject = async function setCurrentProjectApi(args = {}, user) {
    if (pgBoot.storageMode() !== 'postgres') {
      return { slug: 'main', role: user && user.role };
    }
    const slug = String(args.slug || '').trim();
    const info = await withClient((client) => getMembershipForUser(client, {
      username: user.name,
      slug,
    }));
    if (!info) {
      throw Object.assign(new Error('user-not-found'), { messageId: 'errors-user-is-not-logged' });
    }
    const isServerAdmin = !!info.isServerAdmin || !!user.isServerAdmin;
    if (!isServerAdmin && !info.membership) {
      throw Object.assign(new Error('no-membership'), { messageId: 'errors-forbidden' });
    }
    const loaded = await pgBoot.loadProjectDatabase(slug);
    if (!loaded) {
      throw Object.assign(new Error('project-not-found'), { messageId: 'errors-entity-is-not-exist' });
    }
    await withClient((client) => mergeActivePlayerMemberships(client, slug, loaded.database));
    pgBoot.setActiveProjectSlug(slug);
    await rawDb.setDatabase({ database: loaded.database, preserveManagementInfo: false });
    // Create missing player/questionnaire sheets for memberships (join without signup on this project).
    const playersInfo = (rawDb.database
      && rawDb.database.ManagementInfo
      && rawDb.database.ManagementInfo.PlayersInfo) || {};
    for (const [login, info] of Object.entries(playersInfo)) {
      if (typeof rawDb.provisionPlayerLogin === 'function') {
        rawDb.provisionPlayerLogin({
          userName: login,
          profileName: (info && info.profileName) || login,
        });
      }
    }
    if (pgBoot.storageMode() === 'postgres') {
      await pgBoot.persistDatabase(await rawDb.getDatabase());
    }
    const role = isServerAdmin
      ? 'organizer'
      : (roleFromMembership(info.membership, false) || 'player');
    const sessionPatch = {
      projectId: (info.membership && info.membership.project_id) || loaded.projectId,
      projectSlug: slug,
      role,
      isServerAdmin,
      isAdmin: isServerAdmin || !!(info.membership && info.membership.is_admin),
      isEditor: isServerAdmin || !!(info.membership && info.membership.is_editor),
    };
    if (dbmsRef && typeof dbmsRef.onProjectChanged === 'function') {
      await dbmsRef.onProjectChanged(sessionPatch);
    }
    return {
      slug,
      projectId: sessionPatch.projectId,
      role,
      isServerAdmin,
      name: info.membership && info.membership.project_name,
    };
  };

  rawDb.requestProjectJoin = async function requestProjectJoinApi(args = {}, user) {
    if (pgBoot.storageMode() !== 'postgres') {
      throw Object.assign(new Error('postgres-only'), { messageId: 'errors-forbidden' });
    }
    return withClient((client) => requestProjectJoin(client, {
      username: user.name,
      slug: args.slug,
    }));
  };

  rawDb.importProjectFromJson = async function importProjectFromJsonApi(args = {}, user) {
    if (pgBoot.storageMode() !== 'postgres') {
      throw Object.assign(new Error('postgres-only'), { messageId: 'errors-forbidden' });
    }
    const slug = String(args.slug || '').trim();
    const database = args.database;
    if (!slug || !database || typeof database !== 'object') {
      throw Object.assign(new Error('bad-args'), { messageId: 'errors-argument-is-incorrect' });
    }
    const { saveDatabaseToProject } = require('../../nims-dbms/pg/storage');
    const projectId = await withClient(async (client) => {
      // ensure project row exists
      const existing = await client.query(`SELECT id FROM projects WHERE slug = $1`, [slug]);
      if (!existing.rows.length) {
        await createProject(client, {
          slug,
          name: (database.Meta && database.Meta.name) || slug,
          description: (database.Meta && database.Meta.description) || '',
          creatorUsername: user && user.name,
        });
      }
      return saveDatabaseToProject(client, database, slug, { baselineRevision: true });
    });
    return { ok: true, projectId, slug };
  };

  rawDb.getCurrentProject = async function getCurrentProjectApi() {
    return {
      slug: pgBoot.projectSlug(),
      storage: pgBoot.storageMode(),
    };
  };

  rawDb.listServerAdminUsernames = async function listServerAdminUsernamesApi() {
    if (pgBoot.storageMode() !== 'postgres') {
      const name = process.env.NIMS_SERVER_ADMIN || process.env.NIMS_ADMIN_LOGIN || 'admin';
      return [name];
    }
    return withClient(async (client) => {
      const r = await client.query(
        `SELECT username FROM accounts WHERE is_server_admin = true ORDER BY username`,
      );
      return r.rows.map((row) => row.username);
    });
  };

  const origChangeOrganizerPassword = rawDb.changeOrganizerPassword
    && rawDb.changeOrganizerPassword.bind(rawDb);
  if (origChangeOrganizerPassword) {
    rawDb.changeOrganizerPassword = async function changeOrganizerPasswordGuarded(args = {}, user) {
      const userName = String(args.userName || '').trim();
      if (userName && pgBoot.storageMode() === 'postgres') {
        const isSa = await withClient(async (client) => {
          const r = await client.query(
            `SELECT 1 FROM accounts WHERE username = $1 AND is_server_admin = true LIMIT 1`,
            [userName],
          );
          return r.rows.length > 0;
        });
        if (isSa) {
          throw Object.assign(new Error('server-admin-password'), {
            messageId: 'errors-forbidden',
            message: 'Пароль суперадмина меняется в разделе «Проекты»',
          });
        }
      }
      return origChangeOrganizerPassword(args, user);
    };
  }

  rawDb.changeServerAdminPassword = async function changeServerAdminPasswordApi(args = {}, user) {
    if (!user || !user.isServerAdmin || !user.name) {
      throw Object.assign(new Error('forbidden'), { messageId: 'errors-forbidden' });
    }
    const newPassword = String(args.newPassword || '');
    if (!newPassword) {
      throw Object.assign(new Error('password-required'), { messageId: 'errors-password-is-not-specified' });
    }
    const username = user.name;
    const crypto = require('crypto');
    const saltHex = crypto.randomBytes(16).toString('hex');
    const hashedPassword = crypto.scryptSync(newPassword, saltHex, 64).toString('hex');
    const salt = `scrypt$${saltHex}`;

    if (pgBoot.storageMode() === 'postgres') {
      await withClient(async (client) => {
        const upd = await client.query(
          `UPDATE accounts
           SET salt = $2, password_hash = $3, updated_at = now()
           WHERE username = $1 AND is_server_admin = true
           RETURNING id`,
          [username, salt, hashedPassword],
        );
        if (!upd.rows.length) {
          throw Object.assign(new Error('not-server-admin'), { messageId: 'errors-user-is-not-found' });
        }
        const docs = await client.query('SELECT project_id, document FROM project_documents');
        for (const row of docs.rows) {
          const doc = row.document;
          const info = doc
            && doc.ManagementInfo
            && doc.ManagementInfo.UsersInfo
            && doc.ManagementInfo.UsersInfo[username];
          if (!info) continue;
          const next = JSON.parse(JSON.stringify(doc));
          next.ManagementInfo.UsersInfo[username] = {
            ...next.ManagementInfo.UsersInfo[username],
            salt,
            hashedPassword,
          };
          await client.query(
            `UPDATE project_documents SET document = $2::jsonb, updated_at = now() WHERE project_id = $1`,
            [row.project_id, JSON.stringify(next)],
          );
        }
      });
    }

    // Keep in-memory MI in sync with the same hash (do not re-hash via setPassword).
    try {
      const usersInfo = rawDb.database
        && rawDb.database.ManagementInfo
        && rawDb.database.ManagementInfo.UsersInfo;
      if (usersInfo && usersInfo[username]) {
        usersInfo[username].salt = salt;
        usersInfo[username].hashedPassword = hashedPassword;
      }
    } catch {
      /* ignore */
    }
    return { ok: true, username };
  };
}

module.exports = { attachHistoryAndProjectsApi };
