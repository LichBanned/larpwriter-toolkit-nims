'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

// Shared fixture lives in nims-dbms
const fixturePath = path.resolve(__dirname, '../../../nims-dbms/tests/helpers/pgFixture');
const {
  requireDatabaseUrl,
  uniqueSlug,
  minimalDatabase,
  truncateAll,
  ensureAccount,
  afterAllCleanup,
  withClient,
  scryptCreds,
} = require(fixturePath);
const { saveDatabaseToProject, setAccountPassword } = require('../../../nims-dbms/pg/storage');
const { createProject } = require('../../../nims-dbms/pg/projectsApi');
const emptyBase = require('nims-resources/emptyBase');
const { createServerDbms } = require('nims-dbms');
const { wrapWithPermissions } = require('../../permissions');
const { attachHistoryAndProjectsApi } = require('../../pg/attachApi');
const pgBoot = require('../../pg/boot');

describe('attachApi.integration', () => {
  before(() => {
    requireDatabaseUrl();
    process.env.NIMS_STORAGE = 'postgres';
  });
  beforeEach(async () => {
    await truncateAll();
    pgBoot.setActiveProjectSlug('main');
  });
  after(async () => { await afterAllCleanup(); });

  function wireDb(seedDb) {
    const dbmsRef = { db: null, rawDb: null, preparedDb: null };
    const raw = createServerDbms(structuredClone(seedDb || emptyBase.data));
    attachHistoryAndProjectsApi(raw, dbmsRef);
    const prepared = wrapWithPermissions(raw);
    dbmsRef.rawDb = raw;
    dbmsRef.db = raw;
    dbmsRef.preparedDb = prepared;
    return { raw, prepared };
  }

  it('createProject / setCurrentProject / listProjects for server-admin', async () => {
    await ensureAccount('admin', 'Pass1!', { isServerAdmin: true });
    const { prepared } = wireDb();
    const admin = { name: 'admin', role: 'organizer', isServerAdmin: true };

    const slug = uniqueSlug('att');
    const created = await prepared.createProject({ slug, name: 'N' }, admin);
    assert.ok(created);

    const listed = await prepared.listProjects({ includeJoinable: false }, admin);
    assert.ok(listed.some((p) => p.slug === slug));

    const switched = await prepared.setCurrentProject({ slug }, admin);
    assert.equal(switched.slug, slug);
    assert.equal(pgBoot.projectSlug(), slug);

    await assert.rejects(
      () => prepared.createProject({ slug: 'BAD SLUG!' }, admin),
    );
  });

  it('mutate → listEntityRevisions → restoreEntityRevision', async () => {
    await ensureAccount('admin', 'Pass1!', { isServerAdmin: true });
    const slug = uniqueSlug('hist');
    const seed = minimalDatabase({
      Characters: { Hero: { name: 'Hero', bio: 'v1' } },
      ManagementInfo: {
        UsersInfo: {
          admin: {
            name: 'admin', stories: [], characters: ['Hero'], players: [], groups: [],
          },
        },
        PlayersInfo: {},
        admins: ['admin'],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: '',
        PlayersOptions: {},
      },
    });
    await withClient((c) => saveDatabaseToProject(c, seed, slug));
    pgBoot.setActiveProjectSlug(slug);

    const { raw, prepared } = wireDb(seed);
    await raw.setDatabase({ database: structuredClone(seed), preserveManagementInfo: false });
    const admin = { name: 'admin', role: 'organizer', isServerAdmin: true };

    // Simulate audit insert via attach list after manual revision
    const { insertEntityRevision, resolveProjectId, resolveAccountId } = require('../../../nims-dbms/pg/revisions');
    await withClient(async (client) => {
      const projectId = await resolveProjectId(client, slug);
      const accountId = await resolveAccountId(client, 'admin');
      await insertEntityRevision(client, {
        projectId,
        entityType: 'character',
        entityId: 'Hero',
        snapshot: { name: 'Hero', fields: { name: 'Hero', bio: 'v1' } },
        accountId,
        command: 'updateProfileField',
        reason: 'mutate',
      });
      raw.database.Characters.Hero.bio = 'v2';
      await insertEntityRevision(client, {
        projectId,
        entityType: 'character',
        entityId: 'Hero',
        snapshot: { name: 'Hero', fields: { name: 'Hero', bio: 'v2' } },
        accountId,
        command: 'updateProfileField',
        reason: 'mutate',
      });
    });

    const revs = await prepared.listEntityRevisions({
      entityType: 'character', entityId: 'Hero',
    }, admin);
    assert.ok(revs.length >= 2);
    const oldest = revs[revs.length - 1];
    await prepared.restoreEntityRevision({
      entityType: 'character',
      entityId: 'Hero',
      revision: oldest.revision,
    }, admin);
    assert.equal(raw.database.Characters.Hero.bio, 'v1');
  });

  it('changeAccountPassword updates accounts only', async () => {
    await ensureAccount('u1', 'OldPass1!', { isServerAdmin: false });
    const { prepared } = wireDb();
    const sa = { name: 'admin', role: 'organizer', isServerAdmin: true };
    await ensureAccount('admin', 'Pass1!', { isServerAdmin: true });
    await prepared.changeAccountPassword({ userName: 'u1', newPassword: 'NewPass1!' }, sa);
    const { getAccountAuth } = require('../../../nims-dbms/pg/storage');
    await withClient(async (client) => {
      const rows = await getAccountAuth(client, 'u1');
      assert.ok(rows[0].password_hash);
      const saltHex = String(rows[0].salt).replace(/^scrypt\$/, '');
      const hash = crypto.scryptSync('NewPass1!', saltHex, 64).toString('hex');
      assert.equal(hash, rows[0].password_hash);
    });
    await prepared.changeServerAdminPassword({ newPassword: 'AdminNew1!' }, sa);
    await assert.rejects(
      () => prepared.changeAccountPassword({ userName: '', newPassword: 'x' }, sa),
    );
    await assert.rejects(
      () => prepared.changeAccountPassword({ userName: 'u1', newPassword: '' }, sa),
    );
    await assert.rejects(
      () => prepared.changeServerAdminPassword({ newPassword: 'x' }, { name: 'u1', isServerAdmin: false }),
    );
  });

  it('archive / listAccounts / import / join / getCurrentProject', async () => {
    await ensureAccount('admin', 'Pass1!', { isServerAdmin: true });
    await ensureAccount('joiner', 'Pass1!', { isServerAdmin: false });
    const { prepared, raw } = wireDb();
    const admin = { name: 'admin', role: 'organizer', isServerAdmin: true };
    const joiner = { name: 'joiner', role: 'player', isServerAdmin: false };

    const slug = uniqueSlug('arc');
    await prepared.createProject({ slug, name: 'Arc' }, admin);
    const cur = await prepared.getCurrentProject({}, admin);
    assert.ok(cur.slug);
    assert.equal(cur.storage, 'postgres');

    const admins = await prepared.listServerAdminUsernames({}, admin);
    assert.ok(admins.includes('admin'));

    const accounts = await prepared.listAccounts({}, admin);
    assert.ok(accounts.some((a) => a.username === 'admin' && a.is_server_admin));

    const slug2 = uniqueSlug('imp');
    const db = minimalDatabase({ Meta: { name: 'Imported' } });
    const imp = await prepared.importProjectFromJson({ slug: slug2, database: db }, admin);
    assert.equal(imp.slug, slug2);

    await prepared.requestProjectJoin({ slug: slug2 }, joiner);

    await prepared.archiveProject({ slug }, admin);
    await assert.rejects(() => prepared.archiveProject({ slug: 'missing-zzz' }, admin));
    await assert.rejects(
      () => prepared.importProjectFromJson({ slug: '', database: null }, admin),
    );

    // non-member cannot switch
    await assert.rejects(
      () => prepared.setCurrentProject({ slug: slug2 }, { name: 'ghost', role: 'player' }),
    );
    void scryptCreds;
    void createProject;
    void setAccountPassword;
    void raw;
  });
});
