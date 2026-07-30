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
    const role = roleFromMembership(info.membership, isServerAdmin) || (isServerAdmin ? 'organizer' : 'player');
    const sessionPatch = {
      projectId: info.membership ? info.membership.project_id : loaded.projectId,
      projectSlug: slug,
      role,
      isServerAdmin,
      isAdmin: !!(info.membership && info.membership.is_admin),
      isEditor: !!(info.membership && info.membership.is_editor),
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
}

module.exports = { attachHistoryAndProjectsApi };
