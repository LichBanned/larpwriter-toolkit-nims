'use strict';

/**
 * Attach history + multiproject API methods onto the raw DBMS object.
 */

const {
  withClient,
  setAccountPassword,
  stripCredentialsFromManagementInfo,
  stripCredentialsFromAllProjectDocuments,
} = require('../../nims-dbms/pg/storage');
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
    if (!slug || !args.database || typeof args.database !== 'object') {
      throw Object.assign(new Error('bad-args'), { messageId: 'errors-argument-is-incorrect' });
    }
    // Content-only: never create/update accounts from the JSON dump.
    const database = JSON.parse(JSON.stringify(args.database));
    const mi = database.ManagementInfo || (database.ManagementInfo = {});
    mi.UsersInfo = {};
    mi.PlayersInfo = {};
    mi.admins = [];
    mi.editors = [];
    mi.admin = '';
    mi.editor = '';
    stripCredentialsFromManagementInfo(mi);

    const { saveDatabaseToProject } = require('../../nims-dbms/pg/storage');
    const projectId = await withClient(async (client) => {
      const existing = await client.query(`SELECT id FROM projects WHERE slug = $1`, [slug]);
      if (!existing.rows.length) {
        await createProject(client, {
          slug,
          name: (database.Meta && database.Meta.name) || slug,
          description: (database.Meta && database.Meta.description) || '',
          creatorUsername: user && user.name,
        });
      }
      return saveDatabaseToProject(client, database, slug, {
        baselineRevision: true,
        syncAccounts: false,
      });
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

  rawDb.listAccounts = async function listAccountsApi() {
    if (pgBoot.storageMode() !== 'postgres') {
      const mi = rawDb.database && rawDb.database.ManagementInfo;
      const saName = process.env.NIMS_SERVER_ADMIN || process.env.NIMS_ADMIN_LOGIN || 'admin';
      const byName = new Map();
      for (const username of Object.keys((mi && mi.UsersInfo) || {})) {
        byName.set(username, {
          username,
          kind: 'organizer',
          is_server_admin: username === saName,
          projects: [],
        });
      }
      for (const username of Object.keys((mi && mi.PlayersInfo) || {})) {
        const prev = byName.get(username);
        if (prev) {
          prev.kind = 'both';
        } else {
          byName.set(username, {
            username,
            kind: 'player',
            is_server_admin: false,
            projects: [],
          });
        }
      }
      return Array.from(byName.values()).sort((a, b) => a.username.localeCompare(b.username, 'ru'));
    }
    return withClient(async (client) => {
      const r = await client.query(`
        SELECT a.username,
               a.kind,
               a.is_server_admin,
               COALESCE(
                 array_agg(DISTINCT p.slug) FILTER (WHERE p.slug IS NOT NULL AND p.archived_at IS NULL),
                 '{}'
               ) AS projects
        FROM accounts a
        LEFT JOIN project_memberships m ON m.account_id = a.id
        LEFT JOIN projects p ON p.id = m.project_id
        GROUP BY a.id
        ORDER BY a.username
      `);
      return r.rows.map((row) => ({
        username: row.username,
        kind: row.kind || 'organizer',
        is_server_admin: !!row.is_server_admin,
        projects: Array.isArray(row.projects) ? row.projects.filter(Boolean) : [],
      }));
    });
  };

  function clearPasswordFromInMemoryMi(userName) {
    const mi = rawDb.database && rawDb.database.ManagementInfo;
    if (!mi) return;
    if (mi.UsersInfo && mi.UsersInfo[userName]) {
      delete mi.UsersInfo[userName].salt;
      delete mi.UsersInfo[userName].hashedPassword;
    }
    if (mi.PlayersInfo && mi.PlayersInfo[userName]) {
      delete mi.PlayersInfo[userName].salt;
      delete mi.PlayersInfo[userName].hashedPassword;
    }
  }

  async function setPasswordInAccounts(userName, newPassword, preferredKind) {
    const crypto = require('crypto');
    const saltHex = crypto.randomBytes(16).toString('hex');
    const hashedPassword = crypto.scryptSync(newPassword, saltHex, 64).toString('hex');
    const salt = `scrypt$${saltHex}`;

    if (pgBoot.storageMode() === 'postgres') {
      await withClient(async (client) => {
        const check = await client.query(
          `SELECT kind FROM accounts WHERE username = $1 LIMIT 1`,
          [userName],
        );
        if (!check.rows.length) {
          throw Object.assign(new Error('user-not-found'), { messageId: 'errors-user-is-not-found' });
        }
        const kind = preferredKind || check.rows[0].kind || 'organizer';
        await setAccountPassword(client, userName, salt, hashedPassword, kind);
      });
      clearPasswordFromInMemoryMi(userName);
      return { ok: true, username: userName };
    }

    const mi = rawDb.database && rawDb.database.ManagementInfo;
    const isOrg = mi && mi.UsersInfo && mi.UsersInfo[userName];
    const isPlayer = mi && mi.PlayersInfo && mi.PlayersInfo[userName];
    if (!isOrg && !isPlayer) {
      throw Object.assign(new Error('user-not-found'), { messageId: 'errors-user-is-not-found' });
    }
    if (isOrg && origChangeOrganizerPassword) {
      await origChangeOrganizerPassword({ userName, newPassword });
      return { ok: true, username: userName };
    }
    if (isPlayer && origChangePlayerPassword) {
      await origChangePlayerPassword({ userName, newPassword });
      return { ok: true, username: userName };
    }
    throw Object.assign(new Error('user-not-found'), { messageId: 'errors-user-is-not-found' });
  }

  const origChangeOrganizerPassword = rawDb.changeOrganizerPassword
    && rawDb.changeOrganizerPassword.bind(rawDb);
  if (origChangeOrganizerPassword) {
    rawDb.changeOrganizerPassword = async function changeOrganizerPasswordSynced(args = {}, user) {
      const userName = String(args.userName || '').trim();
      const result = await origChangeOrganizerPassword(args, user);
      if (userName && pgBoot.storageMode() === 'postgres') {
        const info = rawDb.database
          && rawDb.database.ManagementInfo
          && rawDb.database.ManagementInfo.UsersInfo
          && rawDb.database.ManagementInfo.UsersInfo[userName];
        if (info && info.salt && info.hashedPassword) {
          await withClient(async (client) => {
            await setAccountPassword(client, userName, info.salt, info.hashedPassword, 'organizer');
          });
          clearPasswordFromInMemoryMi(userName);
        }
      }
      return result;
    };
  }

  const origChangePlayerPassword = rawDb.changePlayerPassword
    && rawDb.changePlayerPassword.bind(rawDb);
  if (origChangePlayerPassword) {
    rawDb.changePlayerPassword = async function changePlayerPasswordSynced(args = {}, user) {
      const userName = String(args.userName || '').trim();
      const result = await origChangePlayerPassword(args, user);
      if (userName && pgBoot.storageMode() === 'postgres') {
        const info = rawDb.database
          && rawDb.database.ManagementInfo
          && rawDb.database.ManagementInfo.PlayersInfo
          && rawDb.database.ManagementInfo.PlayersInfo[userName];
        if (info && info.salt && info.hashedPassword) {
          await withClient(async (client) => {
            await setAccountPassword(client, userName, info.salt, info.hashedPassword, 'player');
          });
          clearPasswordFromInMemoryMi(userName);
        }
      }
      return result;
    };
  }

  const origCreateOrganizer = rawDb.createOrganizer && rawDb.createOrganizer.bind(rawDb);
  if (origCreateOrganizer) {
    rawDb.createOrganizer = async function createOrganizerAccounts(args = {}, user) {
      const result = await origCreateOrganizer(args, user);
      const userName = String((args && (args.name || args.userName)) || '').trim();
      if (userName && pgBoot.storageMode() === 'postgres') {
        const info = rawDb.database
          && rawDb.database.ManagementInfo
          && rawDb.database.ManagementInfo.UsersInfo
          && rawDb.database.ManagementInfo.UsersInfo[userName];
        if (info && info.salt && info.hashedPassword) {
          await withClient(async (client) => {
            await setAccountPassword(client, userName, info.salt, info.hashedPassword, 'organizer');
          });
          clearPasswordFromInMemoryMi(userName);
        }
      }
      return result;
    };
  }

  const origCreatePlayer = rawDb.createPlayer && rawDb.createPlayer.bind(rawDb);
  if (origCreatePlayer) {
    rawDb.createPlayer = async function createPlayerAccounts(args = {}, user) {
      const result = await origCreatePlayer(args, user);
      const userName = String((args && (args.userName || args.name)) || '').trim();
      if (userName && pgBoot.storageMode() === 'postgres') {
        const info = rawDb.database
          && rawDb.database.ManagementInfo
          && rawDb.database.ManagementInfo.PlayersInfo
          && rawDb.database.ManagementInfo.PlayersInfo[userName];
        if (info && info.salt && info.hashedPassword) {
          await withClient(async (client) => {
            await setAccountPassword(client, userName, info.salt, info.hashedPassword, 'player');
          });
          clearPasswordFromInMemoryMi(userName);
        }
      }
      return result;
    };
  }

  rawDb.changeAccountPassword = async function changeAccountPasswordApi(args = {}) {
    const userName = String(args.userName || '').trim();
    const newPassword = String(args.newPassword || '');
    if (!userName) {
      throw Object.assign(new Error('user-required'), { messageId: 'errors-user-is-not-found' });
    }
    if (!newPassword) {
      throw Object.assign(new Error('password-required'), { messageId: 'errors-password-is-not-specified' });
    }
    return setPasswordInAccounts(userName, newPassword);
  };

  rawDb.changeServerAdminPassword = async function changeServerAdminPasswordApi(args = {}, user) {
    if (!user || !user.isServerAdmin || !user.name) {
      throw Object.assign(new Error('forbidden'), { messageId: 'errors-forbidden' });
    }
    return rawDb.changeAccountPassword({ userName: user.name, newPassword: args.newPassword }, user);
  };
}

module.exports = { attachHistoryAndProjectsApi };
