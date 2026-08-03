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
const {
  saveDatabaseToProject,
  loadDatabaseFromProject,
  listProjectSlugs,
  getAccountAuth,
  setAccountPassword,
  stripCredentialsFromManagementInfo,
} = require('../../pg/storage');

describe('storage.integration', () => {
  before(() => {
    requireDatabaseUrl();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  after(async () => {
    await afterAllCleanup();
  });

  it('round-trips Characters/Stories/MI and strips credentials from doc', async () => {
    const slug = uniqueSlug('rt');
    const db = minimalDatabase({
      Characters: { Hero: { name: 'Hero', bio: 'x' } },
      Stories: { Arc: { name: 'Arc', events: [], characters: {} } },
      ManagementInfo: {
        UsersInfo: {
          org: {
            name: 'org',
            salt: 'scrypt$dead',
            hashedPassword: 'beef',
            stories: ['Arc'],
            characters: ['Hero'],
            players: [],
            groups: [],
          },
        },
        PlayersInfo: {},
        admins: ['org'],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: 'hi',
        PlayersOptions: { allowPlayerCreation: true, allowCharacterCreation: false },
      },
    });

    await withClient(async (client) => {
      const id = await saveDatabaseToProject(client, db, slug, { baselineRevision: true });
      assert.ok(id);
      const loaded = await loadDatabaseFromProject(client, slug);
      assert.ok(loaded);
      assert.equal(loaded.database.Characters.Hero.bio, 'x');
      assert.ok(loaded.database.Stories.Arc);
      assert.equal(loaded.database.ManagementInfo.WelcomeText, 'hi');
      const ui = loaded.database.ManagementInfo.UsersInfo.org;
      assert.equal(ui.salt, undefined);
      assert.equal(ui.hashedPassword, undefined);
      const auth = await getAccountAuth(client, 'org');
      assert.ok(auth.length);
      assert.ok(auth[0].salt);
      assert.ok(auth[0].password_hash);
    });
  });

  it('rewrite wipe replaces content; listProjectSlugs skips archived', async () => {
    const slug = uniqueSlug('rw');
    const db1 = minimalDatabase({ Characters: { A: { name: 'A' } } });
    const db2 = minimalDatabase({ Characters: { B: { name: 'B' } } });
    await withClient(async (client) => {
      await saveDatabaseToProject(client, db1, slug);
      await saveDatabaseToProject(client, db2, slug);
      const loaded = await loadDatabaseFromProject(client, slug);
      assert.equal(loaded.database.Characters.A, undefined);
      assert.ok(loaded.database.Characters.B);
      const slugs = await listProjectSlugs(client);
      assert.ok(slugs.includes(slug));
    });
  });

  it('setAccountPassword + getAccountAuth multi-membership', async () => {
    await ensureAccount('multi', 'Pass1!', { kind: 'organizer' });
    const s1 = uniqueSlug('m1');
    const s2 = uniqueSlug('m2');
    const db = minimalDatabase({
      ManagementInfo: {
        UsersInfo: { multi: { name: 'multi', stories: [], characters: [], players: [], groups: [] } },
        PlayersInfo: {},
        admins: ['multi'],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: '',
        PlayersOptions: {},
      },
    });
    await withClient(async (client) => {
      await saveDatabaseToProject(client, db, s1);
      await saveDatabaseToProject(client, db, s2);
      const rows = await getAccountAuth(client, 'multi');
      assert.ok(rows.length >= 2);
      const { salt, hashedPassword } = require('../helpers/pgFixture').scryptCreds('Pass2!');
      await setAccountPassword(client, 'multi', salt, hashedPassword, 'both');
      const again = await getAccountAuth(client, 'multi');
      assert.equal(again[0].password_hash, hashedPassword);
    });
  });

  it('stripCredentialsFromManagementInfo returns changed flag', () => {
    const mi = { UsersInfo: { a: { salt: 'x', hashedPassword: 'y' } }, PlayersInfo: {} };
    assert.equal(stripCredentialsFromManagementInfo(mi), true);
    assert.equal(mi.UsersInfo.a.salt, undefined);
    assert.equal(stripCredentialsFromManagementInfo(mi), false);
  });
});
