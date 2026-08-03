'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  requireDatabaseUrl,
  uniqueSlug,
  minimalDatabase,
  truncateAll,
  ensureAccount,
  afterAllCleanup,
  withClient,
} = require('../helpers/pgFixture');
const { saveDatabaseToProject } = require('../../pg/storage');
const {
  createProject,
  listProjectsForUser,
  archiveProject,
  requestProjectJoin,
  mergeActivePlayerMemberships,
  setAccountServerAdmin,
  getMembershipForUser,
  roleFromMembership,
} = require('../../pg/projectsApi');

describe('projectsApi.integration', () => {
  before(() => requireDatabaseUrl());
  beforeEach(async () => { await truncateAll(); });
  after(async () => { await afterAllCleanup(); });

  it('create/list/archive/join and server-admin sees archived', async () => {
    await ensureAccount('admin', 'Pass1!', { isServerAdmin: true });
    await ensureAccount('player1', 'Pass1!', { kind: 'player' });
    const slug = uniqueSlug('prj');

    await withClient(async (client) => {
      const created = await createProject(client, {
        slug, name: 'Game', description: 'd', creatorUsername: 'admin',
      });
      assert.ok(created.id);

      let listed = await listProjectsForUser(client, {
        username: 'admin', isServerAdmin: true, includeJoinable: false,
      });
      assert.ok(listed.some((p) => p.slug === slug));

      const joinable = await listProjectsForUser(client, {
        username: 'player1', isServerAdmin: false, includeJoinable: true,
      });
      assert.ok(joinable.some((p) => p.slug === slug && p.joinable));

      const joined = await requestProjectJoin(client, { username: 'player1', slug });
      assert.equal(joined.memberRole, 'player');

      const mem = await getMembershipForUser(client, { username: 'player1', slug });
      assert.equal(roleFromMembership(mem && mem.membership, false), 'player');

      await archiveProject(client, { slug });
      const asAdmin = await listProjectsForUser(client, {
        username: 'admin', isServerAdmin: true, includeJoinable: false,
      });
      assert.ok(asAdmin.some((p) => p.slug === slug && p.archived_at));

      const asPlayer = await listProjectsForUser(client, {
        username: 'player1', isServerAdmin: false, includeJoinable: false,
      });
      assert.ok(!asPlayer.some((p) => p.slug === slug));
    });
  });

  it('setAccountServerAdmin + mergeActivePlayerMemberships', async () => {
    await ensureAccount('bob', 'Pass1!', { kind: 'player' });
    const slug = uniqueSlug('merge');
    await withClient(async (client) => {
      await createProject(client, { slug, name: slug, creatorUsername: null });
      await requestProjectJoin(client, { username: 'bob', slug });
      const row = await setAccountServerAdmin(client, 'bob', true);
      assert.equal(row.is_server_admin, true);

      const db = minimalDatabase({
        Players: { bob: { name: 'bob' } },
        ManagementInfo: {
          UsersInfo: {},
          PlayersInfo: { stale: { name: 'stale' } },
          admins: [],
          editors: [],
          adaptationRights: 'ByStory',
          WelcomeText: '',
          PlayersOptions: {},
        },
      });
      // also seed membership into a document project via save
      await saveDatabaseToProject(client, db, slug);
      await requestProjectJoin(client, { username: 'bob', slug });
      await mergeActivePlayerMemberships(client, slug, db);
      assert.ok(db.ManagementInfo.PlayersInfo.bob);
    });
  });
});
